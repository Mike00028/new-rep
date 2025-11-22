#!/usr/bin/env python3
"""
gRPC TTS Client for testing
"""

import grpc
import sys
import os
import time

# Add proto generated files to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'protos'))

import tts_pb2
import tts_pb2_grpc

def test_synthesize():
    """Test single synthesis"""
    print("🎯 Testing gRPC TTS - Single Synthesis")
    
    # Create gRPC channel
    channel = grpc.insecure_channel('localhost:50052')
    stub = tts_pb2_grpc.TextToSpeechStub(channel)
    
    # Create synthesis request
    request = tts_pb2.SynthesizeRequest()
    request.text = "Hello! This is a test of the gRPC TTS server using Piper for high-quality speech synthesis."
    request.voice = "en_US-amy-medium"
    request.language = "en"
    
    try:
        print(f"📡 Sending synthesis request: '{request.text[:50]}...'")
        start_time = time.time()
        
        response = stub.Synthesize(request)
        
        end_time = time.time()
        duration = end_time - start_time
        
        if response.success:
            print(f"✅ Synthesis successful!")
            print(f"⏱️ Processing time: {duration:.2f}s")
            print(f"🔊 Audio duration: {response.duration:.2f}s")
            print(f"📊 Audio size: {len(response.audio_data)} bytes")
            print(f"🎵 Sample rate: {response.sample_rate}Hz")
            print(f"📄 Format: {response.format}")
            
            # Save audio file
            output_path = "test_output.wav"
            with open(output_path, 'wb') as f:
                f.write(response.audio_data)
            print(f"💾 Audio saved to: {output_path}")
            
        else:
            print(f"❌ Synthesis failed: {response.error_message}")
            
    except grpc.RpcError as e:
        print(f"❌ gRPC error: {e.code()} - {e.details()}")
    except Exception as e:
        print(f"❌ Error: {e}")

def test_streaming_synthesize():
    """Test streaming synthesis"""
    print("\n🎯 Testing gRPC TTS - Streaming Synthesis")
    
    # Create gRPC channel
    channel = grpc.insecure_channel('localhost:50052')
    stub = tts_pb2_grpc.TextToSpeechStub(channel)
    
    # Create synthesis request
    request = tts_pb2.SynthesizeRequest()
    request.text = "This is a streaming synthesis test. The audio will be delivered in real-time chunks for immediate playback."
    request.voice = "en_US-lessac-medium"
    request.language = "en"
    
    try:
        print(f"📡 Sending streaming synthesis request: '{request.text[:50]}...'")
        start_time = time.time()
        
        audio_chunks = []
        chunk_count = 0
        
        for chunk in stub.StreamingSynthesize(request):
            if chunk.error_message:
                print(f"❌ Streaming error: {chunk.error_message}")
                return
            
            if chunk.audio_data:
                audio_chunks.append(chunk.audio_data)
                chunk_count += 1
                print(f"📦 Received chunk {chunk_count}: {len(chunk.audio_data)} bytes at {chunk.timestamp:.2f}s")
            
            if chunk.is_final:
                end_time = time.time()
                duration = end_time - start_time
                print(f"✅ Streaming synthesis completed!")
                print(f"⏱️ Total processing time: {duration:.2f}s")
                print(f"📦 Total chunks: {chunk_count}")
                
                # Combine and save audio
                combined_audio = b''.join(audio_chunks)
                output_path = "test_streaming_output.wav"
                with open(output_path, 'wb') as f:
                    f.write(combined_audio)
                print(f"💾 Streaming audio saved to: {output_path}")
                break
        
    except grpc.RpcError as e:
        print(f"❌ gRPC error: {e.code()} - {e.details()}")
    except Exception as e:
        print(f"❌ Error: {e}")

def test_get_voices():
    """Test getting available voices"""
    print("\n🎯 Testing gRPC TTS - Get Voices")
    
    # Create gRPC channel
    channel = grpc.insecure_channel('localhost:50052')
    stub = tts_pb2_grpc.TextToSpeechStub(channel)
    
    # Create request
    request = tts_pb2.GetVoicesRequest()
    request.language = "en"  # Filter for English voices
    
    try:
        print("📡 Requesting available voices...")
        
        response = stub.GetVoices(request)
        
        if response.success:
            print(f"✅ Found {len(response.voices)} voices:")
            for voice in response.voices:
                print(f"  🗣️ {voice.name}")
                print(f"     Language: {voice.language}")
                print(f"     Gender: {voice.gender}")
                print(f"     Quality: {voice.quality}")
                print(f"     Sample rates: {list(voice.sample_rates)}")
                print()
        else:
            print(f"❌ Failed to get voices: {response.error_message}")
            
    except grpc.RpcError as e:
        print(f"❌ gRPC error: {e.code()} - {e.details()}")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == '__main__':
    print("🚀 gRPC TTS Client Test")
    print("=" * 50)
    
    # Test all functionality
    test_get_voices()
    test_synthesize()
    test_streaming_synthesize()
    
    print("\n🎉 All tests completed!")