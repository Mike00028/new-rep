#!/usr/bin/env python3
"""
Test script to verify the STT server can handle multiple concurrent requests
"""
import asyncio
import aiohttp
import time
import io
import wave
import numpy as np

def create_test_audio(duration_seconds=5, sample_rate=16000, frequency=440):
    """Create a simple test audio file in memory"""
    # Generate a sine wave
    t = np.linspace(0, duration_seconds, int(sample_rate * duration_seconds), False)
    wave_data = np.sin(frequency * 2 * np.pi * t)
    
    # Convert to 16-bit integers
    wave_data = (wave_data * 32767).astype(np.int16)
    
    # Create WAV file in memory
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(wave_data.tobytes())
    
    buffer.seek(0)
    return buffer.getvalue()

async def make_transcription_request(session, url, audio_data, request_id=None):
    """Make a single STT request"""
    
    start_time = time.time()
    try:
        # Prepare the multipart form data
        data = aiohttp.FormData()
        data.add_field('file', 
                      audio_data, 
                      filename=f'test_audio_{request_id}.wav',
                      content_type='audio/wav')
        data.add_field('model', 'base')
        data.add_field('language', 'en')
        data.add_field('response_format', 'text')
        
        async with session.post(url, data=data) as response:
            if response.status == 200:
                result = await response.json()
                end_time = time.time()
                text = result.get('text', 'No transcription found')
                print(f"Request {request_id}: SUCCESS - '{text[:50]}...' in {end_time - start_time:.2f}s")
                return True, text, end_time - start_time
            else:
                error_text = await response.text()
                end_time = time.time()
                print(f"Request {request_id}: FAILED - Status {response.status}: {error_text}")
                return False, "", end_time - start_time
    except Exception as e:
        end_time = time.time()
        print(f"Request {request_id}: ERROR - {str(e)}")
        return False, "", end_time - start_time

async def test_concurrent_requests(server_url="http://localhost:5200/v1/transcriptions", num_requests=5):
    """Test multiple concurrent requests to the STT server"""
    
    print(f"Testing {num_requests} concurrent requests to {server_url}")
    print("-" * 60)
    
    # Create test audio files with different frequencies for variety
    test_audio_files = []
    frequencies = [440, 523, 659, 784, 880]  # Musical notes
    
    for i in range(num_requests):
        freq = frequencies[i % len(frequencies)]
        audio_data = create_test_audio(duration_seconds=3, frequency=freq)
        test_audio_files.append(audio_data)
    
    # Add authentication header with dummy API key
    headers = {"Authorization": "Bearer dummy_api_key"}
    
    async with aiohttp.ClientSession(headers=headers) as session:
        # Create tasks for concurrent requests
        tasks = []
        for i in range(num_requests):
            audio_data = test_audio_files[i]
            task = make_transcription_request(session, server_url, audio_data, i+1)
            tasks.append(task)
        
        # Execute all requests concurrently
        start_time = time.time()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        end_time = time.time()
        
        # Analyze results
        successful = sum(1 for result in results if isinstance(result, tuple) and result[0])
        failed = len(results) - successful
        total_time = end_time - start_time
        
        print("-" * 60)
        print(f"Test Results:")
        print(f"  Total requests: {num_requests}")
        print(f"  Successful: {successful}")
        print(f"  Failed: {failed}")
        print(f"  Total time: {total_time:.2f}s")
        print(f"  Average time per request: {total_time/num_requests:.2f}s")
        
        if successful > 0:
            avg_response_time = sum(result[2] for result in results if isinstance(result, tuple) and result[0]) / successful
            print(f"  Average response time (successful): {avg_response_time:.2f}s")

async def test_health_check(server_url="http://localhost:5200/info"):
    """Test the health check endpoint"""
    print("Testing STT server health check endpoint...")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(server_url) as response:
                if response.status == 200:
                    print(f"Health check: OK - Server is running")
                    return True
                else:
                    print(f"Health check: FAILED - Status {response.status}")
                    return False
    except Exception as e:
        print(f"Health check: ERROR - {str(e)}")
        return False

async def main():
    """Main test function"""
    print("STT Server Concurrent Request Test")
    print("=" * 60)
    
    # Test health check first
    if not await test_health_check():
        print("Server is not responding. Please start the STT server first.")
        return
    
    print()
    
    # Test concurrent requests
    await test_concurrent_requests(num_requests=3)
    
    print()
    print("Testing with 5 concurrent requests...")
    await test_concurrent_requests(num_requests=5)
    
    print()
    print("Testing with 10 concurrent requests...")
    await test_concurrent_requests(num_requests=10)

if __name__ == "__main__":
    try:
        import numpy as np
        asyncio.run(main())
    except ImportError:
        print("Error: numpy is required for this test. Install with: pip install numpy")
        print("Skipping audio generation test.")