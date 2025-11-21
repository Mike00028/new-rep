# LLM Server - Ollama Chat API + Fast STT

FastAPI server providing:
- Streaming chat completions backed by Ollama with session memory
- High-speed speech-to-text endpoint powered by [faster-whisper](https://github.com/SYSTRAN/faster-whisper)

## Installation

```powershell
pip install -r requirements.txt
```

## Running the Server

```powershell
python main.py
```

Server will start on `http://localhost:11435`.

## API Endpoint

### POST `/chat/`

Stream chat completions from Ollama.

**Request:**
```json
{
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "language": "en",
  "model": "llama3.2"
}
```

**Response:** Server-Sent Events (SSE) stream

---

### POST `/stt/fast`

Fast speech-to-text using `faster-whisper`.

Send an audio file (wav/mp3/ogg/webm) via multipart/form-data.

**Form Fields:**
- `file`: audio file (required)
- `language`: optional language code (e.g. `en`). If omitted, auto-detect.
- `task`: `transcribe` (default) or `translate`

**Example (PowerShell):**
```powershell
Invoke-RestMethod -Uri http://localhost:11435/stt/fast -Method POST -Form @{ 
  file = Get-Item .\sample.wav; language = 'en'; task = 'transcribe' 
}
```

**Response JSON:**
```json
{
  "text": "hello world",
  "language": "en",
  "segments": [
    {"id":0, "start":0.0, "end":1.6, "text":"hello world", "tokens":[...]} 
  ],
  "model": "faster-whisper",
  "task": "transcribe"
}
```

**Environment Variables (optional):**
- `FAST_WHISPER_MODEL` (default `base`) – e.g. `tiny.en`, `small`, `medium`, `large-v3`
- `FAST_WHISPER_DEVICE` (default `auto`) – `cpu` or `cuda`
- `FAST_WHISPER_COMPUTE_TYPE` (default `int8`) – `int8`, `int8_float16`, `float16`, `float32`

Choose smaller models (like `tiny.en`) for lowest latency; larger for accuracy.

---

## Notes

The STT endpoint loads the model once and reuses it for all requests (thread-safe). If you change model env vars, restart the server.

For production, consider pinning model versions and enabling GPU (`FAST_WHISPER_DEVICE=cuda`) with an appropriate `FAST_WHISPER_COMPUTE_TYPE` (e.g. `float16`).
