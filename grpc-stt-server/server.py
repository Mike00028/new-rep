import os
import sys
import logging
import asyncio
import io
import tempfile
from concurrent import futures
from typing import Optional

import grpc
import torch
import numpy as np
from faster_whisper import WhisperModel

# Add the generated directory to the path
sys.path.append(os.path.join(os.path.dirname(__file__), 'generated'))

import stt_pb2
import stt_pb2_grpc

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class STTConfig:
    """Configuration for the STT server"""
    def __init__(self):
        # Device configuration
        self.device = "cpu" if os.getenv("FORCE_CPU", "false").lower() == "true" else ("cuda" if torch.cuda.is_available() else "cpu")
        self.compute_type = "float16" if self.device == "cuda" else "int8"
        
        # Model configuration
        self.default_model = os.getenv("DEFAULT_MODEL", "distil-medium.en")
        self.max_threads = int(os.getenv("MAX_THREADS", "6"))
        
        # Server configuration
        self.server_port = int(os.getenv("GRPC_PORT", "50051"))
        self.max_workers = int(os.getenv("MAX_WORKERS", "10"))
        
        # Supported configurations
        self.supported_models = [
            "tiny.en", "tiny", "base.en", "base", "small.en", "small", 
            "medium.en", "medium", "large-v1", "large-v2", "large-v3", 
            "large", "distil-large-v2", "distil-medium.en", "distil-small.en", 
            "distil-large-v3"
        ]
        
        self.supported_languages = [
            "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs", 
            "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", 
            "fo", "fr", "gl", "gu", "ha", "haw", "he", "hi", "hr", "ht", "hu", "hy", 
            "id", "is", "it", "ja", "jw", "ka", "kk", "km", "kn", "ko", "la", "lb", 
            "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt", 
            "my", "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps", "pt", "ro", "ru", 
            "sa", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su", "sv", "sw", 
            "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi", 
            "yi", "yo", "zh", "yue"
        ]
        
        self.supported_formats = ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "opus", "flac", "ogg"]
        self.supported_response_formats = ["text", "verbose_json"]
        self.supported_timestamp_granularities = ["segment", "word"]

class STTServicer(stt_pb2_grpc.SpeechToTextServicer):
    """gRPC service implementation for Speech-to-Text"""
    
    def __init__(self, config: STTConfig):
        self.config = config
        self.models = {}  # Model cache
        logger.info(f"Initializing STT server with device: {config.device}")
        
        # Pre-load the default model
        self._get_model(config.default_model)
    
    def _get_model(self, model_name: str) -> WhisperModel:
        """Get or create a cached model instance"""
        if model_name not in self.models:
            try:
                logger.info(f"Loading model: {model_name}")
                self.models[model_name] = WhisperModel(
                    model_name, 
                    device=self.config.device, 
                    compute_type=self.config.compute_type
                )
                logger.info(f"Successfully loaded model: {model_name}")
            except Exception as e:
                logger.error(f"Failed to load model {model_name}: {e}")
                raise
        return self.models[model_name]
    
    def _audio_bytes_to_file(self, audio_data: bytes) -> str:
        """Convert audio bytes to a temporary file with validation"""
        
        # Validate audio data
        if not audio_data or len(audio_data) < 44:
            raise ValueError(f"Invalid audio data: too short ({len(audio_data) if audio_data else 0} bytes)")
        
        # Basic WAV header validation
        if not audio_data.startswith(b'RIFF'):
            raise ValueError("Invalid WAV file: missing RIFF header")
            
        if b'WAVE' not in audio_data[:12]:
            raise ValueError("Invalid WAV file: missing WAVE format")
        
        logger.info(f"Audio data validation passed: {len(audio_data)} bytes")
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_file:
            temp_file.write(audio_data)
            return temp_file.name
    
    def _create_segment_proto(self, segment) -> stt_pb2.Segment:
        """Convert a Whisper segment to protobuf format"""
        segment_proto = stt_pb2.Segment()
        segment_proto.id = segment.id
        segment_proto.start = segment.start
        segment_proto.end = segment.end
        segment_proto.text = segment.text
        
        # Handle optional attributes
        if hasattr(segment, 'tokens'):
            segment_proto.tokens.extend(segment.tokens)
        if hasattr(segment, 'temperature'):
            segment_proto.temperature = segment.temperature
        if hasattr(segment, 'avg_logprob'):
            segment_proto.avg_logprob = segment.avg_logprob
        if hasattr(segment, 'compression_ratio'):
            segment_proto.compression_ratio = segment.compression_ratio
        if hasattr(segment, 'no_speech_prob'):
            segment_proto.no_speech_prob = segment.no_speech_prob
            
        return segment_proto
    
    def _create_word_proto(self, word) -> stt_pb2.Word:
        """Convert a Whisper word to protobuf format"""
        word_proto = stt_pb2.Word()
        word_proto.word = word.word
        word_proto.start = word.start
        word_proto.end = word.end
        if hasattr(word, 'probability'):
            word_proto.probability = word.probability
        return word_proto
    
    def Transcribe(self, request: stt_pb2.TranscribeRequest, context) -> stt_pb2.TranscribeResponse:
        """Handle single transcription requests"""
        try:
            logger.info("Received transcription request")
            
            # Validate model
            model_name = request.model if request.model else self.config.default_model
            if model_name not in self.config.supported_models:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details(f"Unsupported model: {model_name}")
                return stt_pb2.TranscribeResponse()
            
            # Validate language
            language = request.language if request.language else None
            if language and language not in self.config.supported_languages:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details(f"Unsupported language: {language}")
                return stt_pb2.TranscribeResponse()
            
            # Get model
            model = self._get_model(model_name)
            
            # Create temporary file from audio data
            temp_file_path = self._audio_bytes_to_file(request.audio_data)
            
            try:
                # Transcribe audio
                transcribe_kwargs = {
                    'language': language,
                    'word_timestamps': request.word_timestamps,
                }
                
                if request.temperature > 0:
                    transcribe_kwargs['temperature'] = request.temperature
                
                if request.vad_threshold > 0:
                    transcribe_kwargs['vad_threshold'] = request.vad_threshold
                
                segments, info = model.transcribe(temp_file_path, **transcribe_kwargs)
                
                # Build response
                response = stt_pb2.TranscribeResponse()
                response.language = info.language
                response.duration = info.duration
                response.success = True
                
                # Collect segments and build full text
                full_text = ""
                for segment in segments:
                    response.segments.append(self._create_segment_proto(segment))
                    full_text += segment.text
                    
                    # Add words if requested
                    if request.word_timestamps and hasattr(segment, 'words'):
                        for word in segment.words:
                            response.words.append(self._create_word_proto(word))
                
                response.text = full_text.strip()
                
                logger.info(f"Transcription completed successfully. Language: {info.language}, Duration: {info.duration:.2f}s")
                return response
                
            finally:
                # Clean up temporary file
                try:
                    os.unlink(temp_file_path)
                except:
                    pass
                    
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            response = stt_pb2.TranscribeResponse()
            response.success = False
            response.error_message = str(e)
            return response
    
    def StreamingTranscribe(self, request_iterator, context):
        """Handle streaming transcription requests"""
        try:
            logger.info("Starting streaming transcription")
            
            config = None
            model = None
            audio_buffer = io.BytesIO()
            
            for request in request_iterator:
                if request.HasField('config'):
                    # Handle configuration
                    config = request.config
                    model_name = config.model if config.model else self.config.default_model
                    
                    if model_name not in self.config.supported_models:
                        response = stt_pb2.StreamingTranscribeResponse()
                        response.error_message = f"Unsupported model: {model_name}"
                        yield response
                        return
                    
                    model = self._get_model(model_name)
                    logger.info(f"Streaming configured with model: {model_name}")
                    
                elif request.HasField('audio_chunk'):
                    # Handle audio chunk
                    if model is None:
                        response = stt_pb2.StreamingTranscribeResponse()
                        response.error_message = "Configuration required before audio data"
                        yield response
                        return
                    
                    audio_buffer.write(request.audio_chunk)
                    
                    # Accumulate more audio for better accuracy
                    # Process when we have at least 2 seconds of audio
                    if audio_buffer.tell() > 32000:  # 32000 bytes ≈ 2 seconds at 16kHz
                        try:
                            temp_file_path = self._audio_bytes_to_file(audio_buffer.getvalue())
                            
                            segments, info = model.transcribe(
                                temp_file_path,
                                language=config.language if config.language else None,
                                word_timestamps=config.word_timestamps
                            )
                            
                            for segment in segments:
                                response = stt_pb2.StreamingTranscribeResponse()
                                response.text = segment.text
                                response.is_final = True  # For simplicity, marking all as final
                                response.confidence = 1.0  # Whisper doesn't provide confidence scores
                                response.segments.append(self._create_segment_proto(segment))
                                
                                if config.word_timestamps and hasattr(segment, 'words'):
                                    for word in segment.words:
                                        response.words.append(self._create_word_proto(word))
                                
                                yield response
                            
                            # Clean up
                            try:
                                os.unlink(temp_file_path)
                            except:
                                pass
                            
                            # Reset buffer
                            audio_buffer = io.BytesIO()
                            
                        except Exception as e:
                            response = stt_pb2.StreamingTranscribeResponse()
                            response.error_message = str(e)
                            yield response
                            
        except Exception as e:
            logger.error(f"Streaming transcription error: {e}")
            response = stt_pb2.StreamingTranscribeResponse()
            response.error_message = str(e)
            yield response
    
    def GetCapabilities(self, request: stt_pb2.CapabilitiesRequest, context) -> stt_pb2.CapabilitiesResponse:
        """Return server capabilities"""
        response = stt_pb2.CapabilitiesResponse()
        response.supported_models.extend(self.config.supported_models)
        response.supported_languages.extend(self.config.supported_languages)
        response.supported_formats.extend(self.config.supported_formats)
        response.supported_response_formats.extend(self.config.supported_response_formats)
        response.supported_timestamp_granularities.extend(self.config.supported_timestamp_granularities)
        
        logger.info("Capabilities request served")
        return response

def serve():
    """Start the gRPC server"""
    config = STTConfig()
    
    # Create server
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=config.max_workers))
    
    # Add servicer
    stt_pb2_grpc.add_SpeechToTextServicer_to_server(STTServicer(config), server)
    
    # Configure server address
    listen_addr = f'[::]:{config.server_port}'
    server.add_insecure_port(listen_addr)
    
    # Start server
    server.start()
    logger.info(f"gRPC STT Server started on {listen_addr}")
    logger.info(f"Using device: {config.device}")
    logger.info(f"Default model: {config.default_model}")
    
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        logger.info("Shutting down server...")
        server.stop(grace=5)

if __name__ == '__main__':
    serve()