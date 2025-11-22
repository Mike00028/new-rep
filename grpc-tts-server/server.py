#!/usr/bin/env python3
"""
gRPC Text-to-Speech Server using Piper
High-performance TTS with streaming support
"""

import grpc
from concurrent import futures
import logging
import os
import sys
import tempfile
import json
import subprocess
import io
from typing import List, Dict, Optional
import threading
import time

# Add proto generated files to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'protos'))

import tts_pb2
import tts_pb2_grpc

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class TTSConfig:
    def __init__(self):
        self.piper_path = os.path.join(os.path.dirname(__file__), '..', 'tts-server', 'piper', 'piper', 'piper.exe')
        self.voices_dir = os.path.join(os.path.dirname(__file__), '..', 'tts-server', 'voice_samples')
        self.default_voice = 'en_US-amy-medium'
        self.default_sample_rate = 22050
        self.chunk_size = 8192  # Bytes per streaming chunk
        
        # Available voices
        self.voices = {
            'en_US-amy-medium': {
                'name': 'en_US-amy-medium',
                'language': 'en_US',
                'gender': 'female',
                'quality': 'medium',
                'sample_rates': [22050]
            },
            'en_US-lessac-medium': {
                'name': 'en_US-lessac-medium',
                'language': 'en_US',
                'gender': 'male',
                'quality': 'medium',
                'sample_rates': [22050]
            }
        }

class TTSServicer(tts_pb2_grpc.TextToSpeechServicer):
    def __init__(self):
        self.config = TTSConfig()
        logger.info(f"TTS Service initialized with Piper at: {self.config.piper_path}")
        logger.info(f"Available voices: {list(self.config.voices.keys())}")
    
    def _get_voice_path(self, voice_name: str) -> tuple[str, str]:
        """Get the .onnx and .json paths for a voice"""
        onnx_path = os.path.join(self.config.voices_dir, f"{voice_name}.onnx")
        json_path = os.path.join(self.config.voices_dir, f"{voice_name}.onnx.json")
        return onnx_path, json_path
    
    def _validate_voice(self, voice_name: str) -> bool:
        """Check if voice files exist"""
        onnx_path, json_path = self._get_voice_path(voice_name)
        return os.path.exists(onnx_path) and os.path.exists(json_path)
    
    def _synthesize_with_piper(self, text: str, voice: str, output_path: str) -> bool:
        """Synthesize speech using Piper"""
        try:
            onnx_path, json_path = self._get_voice_path(voice)
            
            if not self._validate_voice(voice):
                logger.error(f"Voice files not found for: {voice}")
                return False
            
            # Prepare Piper command
            cmd = [
                self.config.piper_path,
                '--model', onnx_path,
                '--config', json_path,
                '--output_file', output_path
            ]
            
            logger.info(f"Running Piper synthesis: {' '.join(cmd)}")
            
            # Run Piper with text input
            process = subprocess.run(
                cmd,
                input=text,
                text=True,
                capture_output=True,
                timeout=30
            )
            
            if process.returncode != 0:
                logger.error(f"Piper synthesis failed: {process.stderr}")
                return False
                
            return os.path.exists(output_path)
            
        except subprocess.TimeoutExpired:
            logger.error("Piper synthesis timed out")
            return False
        except Exception as e:
            logger.error(f"Error in Piper synthesis: {e}")
            return False
    
    def Synthesize(self, request, context):
        """Single synthesis request"""
        try:
            logger.info("=" * 60)
            logger.info("🎯 SYNTHESIZE REQUEST RECEIVED")
            logger.info(f"📝 Text: '{request.text}'")
            logger.info(f"🎤 Voice: '{request.voice}'")
            logger.info(f"📊 Text length: {len(request.text)} characters")
            logger.info(f"🌐 Client: {context.peer()}")
            logger.info("=" * 60)
            
            # Validate input
            if not request.text.strip():
                logger.error("❌ Empty text provided")
                response = tts_pb2.SynthesizeResponse()
                response.success = False
                response.error_message = "Empty text provided"
                return response
            
            # Use default voice if not specified
            voice = request.voice if request.voice else self.config.default_voice
            
            if not self._validate_voice(voice):
                response = tts_pb2.SynthesizeResponse()
                response.success = False
                response.error_message = f"Voice not found: {voice}"
                return response
            
            # Create temporary output file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                temp_path = temp_file.name
            
            try:
                # Synthesize with Piper
                synthesis_start = time.time()
                success = self._synthesize_with_piper(request.text, voice, temp_path)
                synthesis_duration = time.time() - synthesis_start
                
                if not success:
                    response = tts_pb2.SynthesizeResponse()
                    response.success = False
                    response.error_message = "Synthesis failed"
                    return response
                
                # Read generated audio
                with open(temp_path, 'rb') as audio_file:
                    audio_data = audio_file.read()
                
                # Calculate audio duration (rough estimate)
                # WAV header is 44 bytes, then raw audio data
                if len(audio_data) > 44:
                    audio_bytes = len(audio_data) - 44
                    duration = audio_bytes / (self.config.default_sample_rate * 2)  # 16-bit audio
                else:
                    duration = 0.0
                
                logger.info(f"Synthesis completed in {synthesis_duration:.2f}s, audio duration: {duration:.2f}s")
                
                # Create response
                response = tts_pb2.SynthesizeResponse()
                response.audio_data = audio_data
                response.duration = duration
                response.sample_rate = self.config.default_sample_rate
                response.format = "wav"
                response.success = True
                
                return response
                
            finally:
                # Clean up temporary file
                try:
                    os.unlink(temp_path)
                except:
                    pass
                    
        except Exception as e:
            logger.error(f"Synthesis error: {e}")
            response = tts_pb2.SynthesizeResponse()
            response.success = False
            response.error_message = str(e)
            return response
    
    def StreamingSynthesize(self, request, context):
        """Streaming synthesis for real-time audio generation"""
        try:
            logger.info("=" * 60)
            logger.info("🎯 STREAMING SYNTHESIZE REQUEST RECEIVED")
            logger.info(f"📝 Text: '{request.text}'")
            logger.info(f"🎤 Voice: '{request.voice}'")
            logger.info(f"📊 Text length: {len(request.text)} characters")
            logger.info(f"🌐 Client: {context.peer()}")
            logger.info("=" * 60)
            
            # Validate input
            if not request.text.strip():
                logger.error("❌ Empty text provided for streaming")
                chunk = tts_pb2.AudioChunk()
                chunk.error_message = "Empty text provided"
                yield chunk
                return
            
            # Use default voice if not specified
            voice = request.voice if request.voice else self.config.default_voice
            
            if not self._validate_voice(voice):
                chunk = tts_pb2.AudioChunk()
                chunk.error_message = f"Voice not found: {voice}"
                yield chunk
                return
            
            # Create temporary output file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                temp_path = temp_file.name
            
            try:
                # Synthesize with Piper
                success = self._synthesize_with_piper(request.text, voice, temp_path)
                
                if not success:
                    chunk = tts_pb2.AudioChunk()
                    chunk.error_message = "Synthesis failed"
                    yield chunk
                    return
                
                # Stream the audio in chunks
                with open(temp_path, 'rb') as audio_file:
                    timestamp = 0.0
                    
                    while True:
                        audio_chunk = audio_file.read(self.config.chunk_size)
                        if not audio_chunk:
                            break
                        
                        # Create audio chunk message
                        chunk = tts_pb2.AudioChunk()
                        chunk.audio_data = audio_chunk
                        chunk.is_final = False
                        chunk.timestamp = timestamp
                        
                        yield chunk
                        
                        # Estimate timestamp increment (rough)
                        if len(audio_chunk) > 0:
                            timestamp += len(audio_chunk) / (self.config.default_sample_rate * 2)
                    
                    # Send final chunk
                    final_chunk = tts_pb2.AudioChunk()
                    final_chunk.is_final = True
                    final_chunk.timestamp = timestamp
                    yield final_chunk
                    
            finally:
                # Clean up temporary file
                try:
                    os.unlink(temp_path)
                except:
                    pass
                    
        except Exception as e:
            logger.error(f"Streaming synthesis error: {e}")
            chunk = tts_pb2.AudioChunk()
            chunk.error_message = str(e)
            yield chunk
    
    def GetVoices(self, request, context):
        """Get available voices"""
        try:
            logger.info(f"GetVoices request: language filter='{request.language}'")
            
            response = tts_pb2.GetVoicesResponse()
            
            for voice_name, voice_info in self.config.voices.items():
                # Filter by language if specified
                if request.language and not voice_info['language'].startswith(request.language):
                    continue
                
                # Only include voices that have actual files
                if not self._validate_voice(voice_name):
                    continue
                
                voice = tts_pb2.Voice()
                voice.name = voice_info['name']
                voice.language = voice_info['language']
                voice.gender = voice_info['gender']
                voice.quality = voice_info['quality']
                voice.sample_rates.extend(voice_info['sample_rates'])
                
                response.voices.append(voice)
            
            response.success = True
            logger.info(f"Returning {len(response.voices)} voices")
            
            return response
            
        except Exception as e:
            logger.error(f"GetVoices error: {e}")
            response = tts_pb2.GetVoicesResponse()
            response.success = False
            response.error_message = str(e)
            return response

def serve():
    """Start the gRPC TTS server"""
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    tts_pb2_grpc.add_TextToSpeechServicer_to_server(TTSServicer(), server)
    
    port = os.getenv('GRPC_TTS_PORT', '50052')
    listen_addr = f'[::]:{port}'
    server.add_insecure_port(listen_addr)
    
    logger.info(f"Starting gRPC TTS server on {listen_addr}")
    logger.info("Available methods: Synthesize, StreamingSynthesize, GetVoices")
    
    server.start()
    
    try:
        while True:
            time.sleep(86400)  # Sleep for a day
    except KeyboardInterrupt:
        logger.info("Shutting down gRPC TTS server...")
        server.stop(0)

if __name__ == '__main__':
    serve()