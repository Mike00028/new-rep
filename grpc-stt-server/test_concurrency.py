#!/usr/bin/env python3
"""
Concurrency test for gRPC STT server
Tests multiple simultaneous transcription requests
"""

import asyncio
import grpc
import time
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import sys
import os

# Add the generated directory to the path
sys.path.append(os.path.join(os.path.dirname(__file__), 'generated'))

import stt_pb2
import stt_pb2_grpc

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(threadName)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class ConcurrentSTTTester:
    def __init__(self, server_host='localhost', server_port=50051):
        self.server_host = server_host
        self.server_port = server_port
        self.server_address = f'{server_host}:{server_port}'
        
    def create_client(self):
        """Create a new gRPC client"""
        channel = grpc.insecure_channel(self.server_address)
        return stt_pb2_grpc.SpeechToTextStub(channel)
    
    def load_test_audio_file(self, duration_category="2s"):
        """Load a real audio file for testing"""
        audio_files = {
            "2s": [
                "test_audio/test_2s_hello.wav",
                "test_audio/test_2s_morning.wav", 
                "test_audio/test_2s_thanks.wav"
            ],
            "3s": [
                "test_audio/test_3s_longer.wav",
                "test_audio/test_3s_technical.wav"
            ],
            "4s": [
                "test_audio/test_4s_weather.wav",
                "test_audio/test_4s_order.wav"
            ],
            "5s": [
                "test_audio/test_5s_technology.wav",
                "test_audio/test_5s_ai.wav"
            ]
        }
        
        import random
        import os
        
        # Select appropriate audio files for duration
        available_files = audio_files.get(duration_category, audio_files["2s"])
        
        # Filter files that actually exist
        existing_files = [f for f in available_files if os.path.exists(f)]
        
        if not existing_files:
            logger.error(f"❌ No test audio files found for {duration_category}. Run generate_test_audio.py first!")
            return None, "No audio files available"
        
        # Randomly select a file
        selected_file = random.choice(existing_files)
        
        try:
            with open(selected_file, 'rb') as f:
                audio_data = f.read()
            
            # Extract expected text from filename for reference
            filename = os.path.basename(selected_file)
            expected_texts = {
                "test_2s_hello.wav": "Hello world, this is a test.",
                "test_2s_morning.wav": "Good morning everyone.",
                "test_2s_thanks.wav": "Thank you very much.",
                "test_3s_longer.wav": "This is a longer sentence for testing speech recognition accuracy.",
                "test_3s_technical.wav": "The server is running on port fifty thousand and fifty one.",
                "test_4s_weather.wav": "The weather is beautiful today, perfect for outdoor activities.",
                "test_4s_order.wav": "Please confirm your order of three items totaling twenty four dollars and ninety five cents.",
                "test_5s_technology.wav": "Speech recognition technology has advanced significantly in recent years, enabling more natural human computer interaction.",
                "test_5s_ai.wav": "Artificial intelligence and machine learning are transforming how we interact with computers and process information in our daily lives."
            }
            
            expected_text = expected_texts.get(filename, "Unknown text")
            logger.info(f"📁 Loaded {selected_file} (Expected: '{expected_text}')")
            
            return audio_data, expected_text
            
        except Exception as e:
            logger.error(f"❌ Failed to load audio file {selected_file}: {e}")
            return None, f"Error loading file: {e}"
    
    def streaming_transcription_test(self, client_id, model='distil-medium.en', language='en', audio_duration=2, chunk_size=8192):
        """Perform a single streaming transcription request"""
        start_time = time.time()
        thread_name = threading.current_thread().name
        
        try:
            logger.info(f"Client {client_id} ({thread_name}): Starting streaming transcription with {audio_duration}s audio")
            
            # Create client
            client = self.create_client()
            
            # Load real test audio
            duration_category = f"{audio_duration}s"
            audio_data, expected_text = self.load_test_audio_file(duration_category)
            
            if audio_data is None:
                raise Exception(f"Failed to load test audio: {expected_text}")
            
            logger.info(f"Client {client_id}: Using audio file with expected text: '{expected_text}'")
            
            # Create streaming request generator
            def request_generator():
                # First, send config
                config = stt_pb2.StreamingConfig(
                    model=model,
                    language=language,
                    interim_results=True,
                    vad_threshold=0.0,
                    word_timestamps=False
                )
                
                yield stt_pb2.StreamingTranscribeRequest(config=config)
                
                # Then send audio chunks (optimized for speed)
                for i in range(0, len(audio_data), chunk_size):
                    chunk = audio_data[i:i + chunk_size]
                    yield stt_pb2.StreamingTranscribeRequest(audio_chunk=chunk)
                    time.sleep(0.01)  # Minimal delay for faster processing
            
            # Make streaming gRPC call
            responses = client.StreamingTranscribe(request_generator())
            
            # Collect all responses
            results = []
            final_text = ""
            interim_count = 0
            
            for response in responses:
                results.append({
                    'text': response.text,
                    'is_final': response.is_final,
                    'confidence': response.confidence
                })
                
                if response.is_final:
                    final_text = response.text
                    logger.info(f"Client {client_id}: Final result: '{response.text}'")
                else:
                    interim_count += 1
                    logger.info(f"Client {client_id}: Interim result {interim_count}: '{response.text}'")
            
            end_time = time.time()
            duration = end_time - start_time
            
            logger.info(f"Client {client_id} ({thread_name}): Streaming completed in {duration:.2f}s")
            logger.info(f"Client {client_id}: Expected: '{expected_text}'")
            logger.info(f"Client {client_id}: Got: '{final_text}' (Audio: {audio_duration}s, Interim: {interim_count})")
            
            return {
                'client_id': client_id,
                'success': True,
                'duration': duration,
                'audio_duration': audio_duration,
                'text': final_text,
                'expected_text': expected_text,
                'interim_count': interim_count,
                'total_responses': len(results),
                'error': None
            }
            
        except Exception as e:
            end_time = time.time()
            duration = end_time - start_time
            
            logger.error(f"Client {client_id} ({thread_name}): Streaming failed in {duration:.2f}s - Error: {e}")
            
            return {
                'client_id': client_id,
                'success': False,
                'duration': duration,
                'audio_duration': audio_duration,
                'text': '',
                'expected_text': '',
                'interim_count': 0,
                'total_responses': 0,
                'error': str(e)
            }
    
    def test_concurrent_requests(self, num_clients=5, model='base', audio_duration=2):
        """Test multiple concurrent transcription requests"""
        logger.info(f"Starting concurrency test with {num_clients} clients using model '{model}' and {audio_duration}s audio")
        logger.info(f"Target server: {self.server_address}")
        
        start_time = time.time()
        results = []
        
        # Use ThreadPoolExecutor for concurrent requests
        with ThreadPoolExecutor(max_workers=num_clients, thread_name_prefix='STTClient') as executor:
            # Submit all requests
            futures = []
            for i in range(num_clients):
                future = executor.submit(self.streaming_transcription_test, i+1, model, 'en', audio_duration)
                futures.append(future)
            
            # Collect results as they complete
            for future in as_completed(futures):
                result = future.result()
                results.append(result)
        
        end_time = time.time()
        total_duration = end_time - start_time
        
        # Analyze results
        successful_requests = [r for r in results if r['success']]
        failed_requests = [r for r in results if not r['success']]
        
        avg_duration = sum(r['duration'] for r in successful_requests) / len(successful_requests) if successful_requests else 0
        min_duration = min(r['duration'] for r in successful_requests) if successful_requests else 0
        max_duration = max(r['duration'] for r in successful_requests) if successful_requests else 0
        
        # Streaming-specific metrics
        avg_interim_count = sum(r['interim_count'] for r in successful_requests) / len(successful_requests) if successful_requests else 0
        avg_total_responses = sum(r['total_responses'] for r in successful_requests) / len(successful_requests) if successful_requests else 0
        
        logger.info("="*60)
        logger.info("STREAMING CONCURRENCY TEST RESULTS")
        logger.info("="*60)
        logger.info(f"Audio duration: {audio_duration}s")
        logger.info(f"Model: {model}")
        logger.info(f"Total clients: {num_clients}")
        logger.info(f"Successful requests: {len(successful_requests)}")
        logger.info(f"Failed requests: {len(failed_requests)}")
        logger.info(f"Success rate: {len(successful_requests)/num_clients*100:.1f}%")
        logger.info(f"Total test duration: {total_duration:.2f}s")
        logger.info(f"Average request duration: {avg_duration:.2f}s")
        logger.info(f"Min request duration: {min_duration:.2f}s")
        logger.info(f"Max request duration: {max_duration:.2f}s")
        logger.info(f"Average interim results per stream: {avg_interim_count:.1f}")
        logger.info(f"Average total responses per stream: {avg_total_responses:.1f}")
        
        # Show transcription results
        if successful_requests:
            logger.info("\n📝 Transcription Results:")
            for req in successful_requests:
                expected = req.get('expected_text', 'N/A')
                actual = req.get('text', '')
                logger.info(f"  Client {req['client_id']}:")
                logger.info(f"    Expected: '{expected}'")
                logger.info(f"    Actual:   '{actual}'")
                if expected.lower().strip() in actual.lower().strip() or actual.lower().strip() in expected.lower().strip():
                    logger.info(f"    Status:   ✅ Match")
                else:
                    logger.info(f"    Status:   ⚠️ Different")
        
        if failed_requests:
            logger.info("\n❌ Failed requests:")
            for req in failed_requests:
                logger.info(f"  Client {req['client_id']}: {req['error']}")
        
        return results
    
    def test_capabilities(self):
        """Test server capabilities"""
        try:
            logger.info("Testing server capabilities...")
            client = self.create_client()
            
            request = stt_pb2.CapabilitiesRequest()
            response = client.GetCapabilities(request)
            
            logger.info("Server capabilities:")
            logger.info(f"  Supported models: {list(response.supported_models)}")
            logger.info(f"  Supported languages: {list(response.supported_languages)}")
            logger.info(f"  Supported formats: {list(response.supported_formats)}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to get capabilities: {e}")
            return False

def main():
    """Main test function"""
    tester = ConcurrentSTTTester()
    
    # Test server capabilities first
    if not tester.test_capabilities():
        logger.error("Server capabilities test failed. Is the server running?")
        return
    
    print("\n" + "="*60)
    print("gRPC STT Server Streaming Concurrency Test")
    print("="*60)
    
    # Test streaming transcription with distil-medium.en model
    test_configs = [
        {'clients': 1, 'model': 'distil-medium.en', 'audio_duration': 2},
        {'clients': 1, 'model': 'distil-medium.en', 'audio_duration': 3},
        {'clients': 1, 'model': 'distil-medium.en', 'audio_duration': 5},
        {'clients': 2, 'model': 'distil-medium.en', 'audio_duration': 2},
        {'clients': 2, 'model': 'distil-medium.en', 'audio_duration': 3},
    ]
    
    for config in test_configs:
        print(f"\n🎙️ Testing {config['clients']} concurrent streaming clients with model '{config['model']}' and {config['audio_duration']}s audio...")
        results = tester.test_concurrent_requests(config['clients'], config['model'], config['audio_duration'])
        time.sleep(3)  # Brief pause between tests

if __name__ == "__main__":
    main()