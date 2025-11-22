import os
import sys
import grpc
import asyncio
import logging
from pathlib import Path

# Add the generated directory to the path
sys.path.append(os.path.join(os.path.dirname(__file__), 'generated'))

import stt_pb2
import stt_pb2_grpc

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class STTClient:
    """gRPC client for Speech-to-Text service"""
    
    def __init__(self, server_address='localhost:50051'):
        self.server_address = server_address
        self.channel = None
        self.stub = None
    
    def connect(self):
        """Connect to the gRPC server"""
        self.channel = grpc.insecure_channel(self.server_address)
        self.stub = stt_pb2_grpc.SpeechToTextStub(self.channel)
        logger.info(f"Connected to STT server at {self.server_address}")
    
    def close(self):
        """Close the connection"""
        if self.channel:
            self.channel.close()
    
    def get_capabilities(self):
        """Get server capabilities"""
        try:
            request = stt_pb2.CapabilitiesRequest()
            response = self.stub.GetCapabilities(request)
            return response
        except grpc.RpcError as e:
            logger.error(f"Failed to get capabilities: {e}")
            return None
    
    def transcribe_file(self, audio_file_path, model=None, language=None, word_timestamps=False):
        """Transcribe an audio file"""
        try:
            # Read audio file
            with open(audio_file_path, 'rb') as f:
                audio_data = f.read()
            
            # Create request
            request = stt_pb2.TranscribeRequest()
            request.audio_data = audio_data
            
            if model:
                request.model = model
            if language:
                request.language = language
            request.word_timestamps = word_timestamps
            
            # Send request
            logger.info(f"Transcribing file: {audio_file_path}")
            response = self.stub.Transcribe(request)
            
            if response.success:
                logger.info("Transcription successful")
                return response
            else:
                logger.error(f"Transcription failed: {response.error_message}")
                return None
                
        except grpc.RpcError as e:
            logger.error(f"gRPC error during transcription: {e}")
            return None
        except FileNotFoundError:
            logger.error(f"Audio file not found: {audio_file_path}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            return None
    
    def transcribe_bytes(self, audio_bytes, model=None, language=None, word_timestamps=False):
        """Transcribe audio from bytes"""
        try:
            # Create request
            request = stt_pb2.TranscribeRequest()
            request.audio_data = audio_bytes
            
            if model:
                request.model = model
            if language:
                request.language = language
            request.word_timestamps = word_timestamps
            
            # Send request
            logger.info("Transcribing audio bytes")
            response = self.stub.Transcribe(request)
            
            if response.success:
                logger.info("Transcription successful")
                return response
            else:
                logger.error(f"Transcription failed: {response.error_message}")
                return None
                
        except grpc.RpcError as e:
            logger.error(f"gRPC error during transcription: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            return None
    
    def streaming_transcribe(self, audio_chunks, model=None, language=None, word_timestamps=False):
        """Perform streaming transcription"""
        def request_generator():
            # Send configuration first
            config = stt_pb2.StreamingConfig()
            if model:
                config.model = model
            if language:
                config.language = language
            config.word_timestamps = word_timestamps
            config.interim_results = True
            
            config_request = stt_pb2.StreamingTranscribeRequest()
            config_request.config.CopyFrom(config)
            yield config_request
            
            # Send audio chunks
            for chunk in audio_chunks:
                audio_request = stt_pb2.StreamingTranscribeRequest()
                audio_request.audio_chunk = chunk
                yield audio_request
        
        try:
            logger.info("Starting streaming transcription")
            responses = self.stub.StreamingTranscribe(request_generator())
            
            for response in responses:
                if response.error_message:
                    logger.error(f"Streaming error: {response.error_message}")
                    break
                yield response
                
        except grpc.RpcError as e:
            logger.error(f"gRPC streaming error: {e}")

def main():
    """Example usage of the STT client"""
    client = STTClient()
    
    try:
        # Connect to server
        client.connect()
        
        # Get capabilities
        print("Getting server capabilities...")
        capabilities = client.get_capabilities()
        if capabilities:
            print(f"Supported models: {list(capabilities.supported_models)}")
            print(f"Supported languages: {list(capabilities.supported_languages)[:10]}...")  # Show first 10
            print(f"Supported formats: {list(capabilities.supported_formats)}")
        
        # Example: Transcribe a file (you'll need to provide a real audio file)
        # audio_file = "path/to/your/audio/file.wav"
        # if os.path.exists(audio_file):
        #     print(f"\nTranscribing file: {audio_file}")
        #     result = client.transcribe_file(audio_file, word_timestamps=True)
        #     if result:
        #         print(f"Transcription: {result.text}")
        #         print(f"Language: {result.language}")
        #         print(f"Duration: {result.duration:.2f}s")
        #         print(f"Segments: {len(result.segments)}")
        #         if result.words:
        #             print(f"Words: {len(result.words)}")
        
        print("\nSTT Client test completed successfully!")
        
    except Exception as e:
        logger.error(f"Client error: {e}")
    finally:
        client.close()

if __name__ == '__main__':
    main()