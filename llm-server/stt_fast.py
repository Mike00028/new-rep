"""Fast STT endpoint utilities using faster-whisper.

Provides a singleton WhisperModel loader and a transcription helper.
"""
from __future__ import annotations
import os
import tempfile
import os
import threading
from typing import List, Dict, Any, Optional

from faster_whisper import WhisperModel

# Environment-configurable model size - using faster models for speed
FAST_WHISPER_MODEL = os.getenv("FAST_WHISPER_MODEL", "distil-medium.en")  # Changed to tiny.en for max speed
FAST_WHISPER_COMPUTE_TYPE = os.getenv("FAST_WHISPER_COMPUTE_TYPE", "int8")  # int8 for maximum speed
FAST_WHISPER_DEVICE = os.getenv("FAST_WHISPER_DEVICE", "cuda")  # cuda for GPU acceleration

_model_lock = threading.Lock()
_model_instance: Optional[WhisperModel] = None


def get_fast_whisper_model() -> WhisperModel:
    """Load (or return cached) faster-whisper model instance with CUDA optimization."""
    global _model_instance
    if _model_instance is None:
        with _model_lock:
            if _model_instance is None:  # double-checked
                try:
                    # Try CUDA first
                    _model_instance = WhisperModel(
                        FAST_WHISPER_MODEL,
                        device="cuda",
                        compute_type="float16",
                        # Performance optimizations
                        cpu_threads=4,
                        num_workers=1,
                    )
                    print(f"✅ Loaded faster-whisper model '{FAST_WHISPER_MODEL}' with CUDA acceleration")
                except Exception as cuda_error:
                    print(f"⚠️ CUDA loading failed: {cuda_error}")
                    print("🔄 Falling back to CPU...")
                    # Fallback to CPU
                    _model_instance = WhisperModel(
                        FAST_WHISPER_MODEL,
                        device="cpu",
                        compute_type="int8",
                        cpu_threads=4,
                        num_workers=1,
                    )
                    print(f"✅ Loaded faster-whisper model '{FAST_WHISPER_MODEL}' with CPU")
    return _model_instance


def transcribe_audio_bytes(data: bytes, language: Optional[str] = None, task: str = "transcribe") -> Dict[str, Any]:
    """Transcribe raw audio bytes using faster-whisper.

    Parameters:
        data: Raw audio bytes.
        language: Optional language code; if None, auto-detect.
        task: "transcribe" or "translate".
    Returns:
        dict with keys: text, language, segments (list of {id, start, end, text, tokens}).
    """
    model = get_fast_whisper_model()
    # Windows fix: NamedTemporaryFile keeps handle open with delete flag; reopen causes PermissionDenied.
    # Use delete=False and close before passing path to model, then remove manually.
    tmp_file = None
    try:
        fd, path = tempfile.mkstemp(suffix=".wav")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
        except Exception:
            # Ensure file descriptor closed even on write failure
            pass
        tmp_file = path
        segments, info = model.transcribe(
            tmp_file,
            language="en",  # Force English for speed (no detection)
            task=task,
            beam_size=1,  # Greedy decoding for max speed
            best_of=1,    # No alternative beams
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=200,  # Even shorter silence detection
                speech_pad_ms=100,  # Minimal padding around speech
                max_speech_duration_s=15,  # Shorter max duration
                threshold=0.7  # Higher VAD threshold
            ),
            temperature=0.0,  # Deterministic, faster
            condition_on_previous_text=False,  # No context for speed
            no_speech_threshold=0.8,  # Much higher threshold to skip non-speech
            compression_ratio_threshold=1.8,  # Even lower quality threshold
            log_prob_threshold=-1.5,  # More lenient probability
            length_penalty=0.8,  # Slight penalty for long outputs
            repetition_penalty=1.1,  # Slight penalty for repetition
            word_timestamps=False,  # Skip word timestamps
            without_timestamps=True,  # Skip all timestamps for speed
            initial_prompt=None,  # No initial context
            suppress_blank=True,  # Skip blank outputs
            suppress_tokens=[-1],  # Suppress end-of-text token
            hallucination_silence_threshold=None  # Disable hallucination detection for speed
        )
        out_segments: List[Dict[str, Any]] = []
        for i, seg in enumerate(segments):
            out_segments.append(
                {
                    "id": i,
                    "start": seg.start,
                    "end": seg.end,
                    "text": seg.text.strip(),
                    "tokens": seg.tokens,
                }
            )
    finally:
        if tmp_file and os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
            except OSError:
                pass
    full_text = " ".join(s["text"] for s in out_segments).strip()
    return {
        "text": full_text,
        "language": info.language,
        "segments": out_segments,
    }
