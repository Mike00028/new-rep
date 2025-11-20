import time
import requests
import os
import wave
import numpy as np

def create_test_audio():
    """Create a simple test audio file with speech-like content"""
    test_audio_path = "./test_audio.wav"
    
    # Create a 2-second audio with speech-like patterns
    sample_rate = 16000
    duration = 2.0
    samples = int(sample_rate * duration)
    
    # Generate speech-like audio (white noise with speech-like envelope)
    t = np.linspace(0, duration, samples)
    
    # Create speech-like patterns with varying amplitude
    envelope = np.where(
        (t > 0.2) & (t < 0.6) | (t > 0.8) & (t < 1.5),  # Speech segments
        0.3 * np.sin(2 * np.pi * 5 * t),  # Modulated amplitude
        0.05  # Background level
    )
    
    # Add some noise to simulate speech
    noise = np.random.normal(0, 0.1, samples)
    audio = envelope * noise
    
    # Normalize to 16-bit range
    audio = np.clip(audio * 32767, -32768, 32767).astype(np.int16)
    
    # Save as WAV file
    with wave.open(test_audio_path, 'w') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(audio.tobytes())
    
    return test_audio_path

def test_stt_performance():
    """Test STT performance with sample audio"""
    url = "http://localhost:11435/stt/fast"
    
    # Create test audio if it doesn't exist
    test_audio_path = "./test_audio.wav"
    if not os.path.exists(test_audio_path):
        print("Creating test audio file...")
        try:
            test_audio_path = create_test_audio()
            print(f"✅ Created {test_audio_path}")
        except ImportError:
            print("❌ numpy not available, cannot create test audio")
            print("Please manually create a 'test_audio.wav' file or install numpy")
            return
        except Exception as e:
            print(f"❌ Error creating test audio: {e}")
            return
    
    print("Testing STT performance...")
    
    # Test 3 times for average
    times = []
    successful_tests = 0
    
    for i in range(3):
        start = time.time()
        
        try:
            with open(test_audio_path, 'rb') as f:
                files = {'file': ('test_audio.wav', f, 'audio/wav')}
                data = {'task': 'transcribe'}
                response = requests.post(url, files=files, data=data)
            
            end = time.time()
            duration = end - start
            times.append(duration)
            
            if response.status_code == 200:
                result = response.json()
                text = result.get('text', '').strip()
                print(f"Test {i+1}: {duration:.2f}s - '{text[:50]}{'...' if len(text) > 50 else ''}'")
                successful_tests += 1
            else:
                print(f"Test {i+1}: Error {response.status_code} - {response.text[:100]}")
                
        except Exception as e:
            end = time.time()
            duration = end - start
            times.append(duration)
            print(f"Test {i+1}: Exception - {str(e)[:100]}")
    
    if times:
        avg_time = sum(times) / len(times)
        print(f"\nAverage STT time: {avg_time:.2f}s")
        print(f"Successful tests: {successful_tests}/3")
        print(f"Model: tiny.en (fastest)")
        print("Optimizations: CUDA, no timestamps, aggressive VAD")
    else:
        print("❌ No timing data collected")

if __name__ == "__main__":
    test_stt_performance()