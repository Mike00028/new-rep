#!/usr/bin/env python3
"""
Test script to verify the Piper TTS server can handle multiple concurrent requests
"""
import asyncio
import aiohttp
import time
import json

async def make_request(session, url, text, language="en", request_id=None):
    """Make a single TTS request"""
    payload = {
        "text": text,
        "language": language
    }
    
    start_time = time.time()
    try:
        async with session.post(url, json=payload) as response:
            if response.status == 200:
                # Read the audio data
                audio_data = await response.read()
                end_time = time.time()
                print(f"Request {request_id}: SUCCESS - {len(audio_data)} bytes in {end_time - start_time:.2f}s")
                return True, len(audio_data), end_time - start_time
            else:
                error_text = await response.text()
                end_time = time.time()
                print(f"Request {request_id}: FAILED - Status {response.status}: {error_text}")
                return False, 0, end_time - start_time
    except Exception as e:
        end_time = time.time()
        print(f"Request {request_id}: ERROR - {str(e)}")
        return False, 0, end_time - start_time

async def test_concurrent_requests(server_url="http://localhost:5100/synthesize/", num_requests=5):
    """Test multiple concurrent requests to the TTS server"""
    
    test_texts = [
        "Hello, this is test number one with a much longer message to properly test the text-to-speech system performance under realistic conditions.",
        "This is the second test message for speech synthesis, designed to evaluate how well the server handles concurrent processing of extended text content.",
        "Third test message to check concurrent processing capabilities with approximately one hundred characters of meaningful content for thorough testing.",
        "Fourth message to test the server's ability to handle multiple requests simultaneously while processing longer sentences that are more representative of real usage.",
        "Final test message number five for concurrent testing, featuring extended text content to simulate realistic workloads and measure performance accurately."
    ]
    
    print(f"Testing {num_requests} concurrent requests to {server_url}")
    print("-" * 60)
    
    async with aiohttp.ClientSession() as session:
        # Create tasks for concurrent requests
        tasks = []
        for i in range(num_requests):
            text = test_texts[i % len(test_texts)]
            task = make_request(session, server_url, text, "en", i+1)
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

async def test_health_check(server_url="http://localhost:5100/"):
    """Test the health check endpoint"""
    print("Testing health check endpoint...")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(server_url) as response:
                if response.status == 200:
                    data = await response.json()
                    print(f"Health check: OK - {data}")
                    return True
                else:
                    print(f"Health check: FAILED - Status {response.status}")
                    return False
    except Exception as e:
        print(f"Health check: ERROR - {str(e)}")
        return False

async def main():
    """Main test function"""
    print("Piper TTS Server Concurrent Request Test")
    print("=" * 60)
    
    # Test health check first
    if not await test_health_check():
        print("Server is not responding. Please start the server first.")
        return
    
    print()
    
    # Test concurrent requests
    await test_concurrent_requests(num_requests=3)
    
    print()
    print("Testing with more concurrent requests...")
    await test_concurrent_requests(num_requests=5)
    
    print()
    print("Testing with 10 concurrent requests...")
    await test_concurrent_requests(num_requests=10)

if __name__ == "__main__":
    asyncio.run(main())