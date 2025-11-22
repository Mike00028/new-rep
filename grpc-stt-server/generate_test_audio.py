#!/usr/bin/env python3
"""
Generate test audio files using Piper TTS server for gRPC STT testing
"""

import requests
import os
import time
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AudioGenerator:
    def __init__(self, piper_url="http://localhost:5100"):
        self.piper_url = piper_url
        self.audio_dir = "test_audio"
        os.makedirs(self.audio_dir, exist_ok=True)
    
    def generate_audio_file(self, text, filename, voice="amy", language="en"):
        """Generate an audio file using Piper TTS"""
        try:
            url = f"{self.piper_url}/synthesize/"
            
            # Piper TTS request
            data = {
                "text": text,
                "voice": voice,
                "language": language,
                "speed": 1.0
            }
            
            logger.info(f"Generating audio for: '{text}' -> {filename}")
            response = requests.post(url, json=data, timeout=30)
            
            if response.status_code == 200:
                filepath = os.path.join(self.audio_dir, filename)
                with open(filepath, 'wb') as f:
                    f.write(response.content)
                logger.info(f"✅ Generated: {filepath}")
                return filepath
            else:
                logger.error(f"❌ Failed to generate audio: {response.status_code}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Error generating audio: {e}")
            return None
    
    def generate_test_suite(self):
        """Generate a suite of test audio files with different durations"""
        
        test_texts = [
            # Short texts (~2 seconds)
            {
                "text": "Hello world, this is a test.",
                "filename": "test_2s_hello.wav",
                "expected_duration": 2
            },
            {
                "text": "Good morning everyone.",
                "filename": "test_2s_morning.wav", 
                "expected_duration": 2
            },
            {
                "text": "Thank you very much.",
                "filename": "test_2s_thanks.wav",
                "expected_duration": 2
            },
            
            # Medium texts (~3-4 seconds)
            {
                "text": "This is a longer sentence for testing speech recognition accuracy.",
                "filename": "test_3s_longer.wav",
                "expected_duration": 3
            },
            {
                "text": "The weather is beautiful today, perfect for outdoor activities.",
                "filename": "test_4s_weather.wav",
                "expected_duration": 4
            },
            
            # Longer texts (~5 seconds)
            {
                "text": "Speech recognition technology has advanced significantly in recent years, enabling more natural human computer interaction.",
                "filename": "test_5s_technology.wav",
                "expected_duration": 5
            },
            {
                "text": "Artificial intelligence and machine learning are transforming how we interact with computers and process information in our daily lives.",
                "filename": "test_5s_ai.wav",
                "expected_duration": 5
            },
            
            # Numbers and technical terms
            {
                "text": "The server is running on port fifty thousand and fifty one.",
                "filename": "test_3s_technical.wav",
                "expected_duration": 3
            },
            
            # Mixed content
            {
                "text": "Please confirm your order of three items totaling twenty four dollars and ninety five cents.",
                "filename": "test_4s_order.wav",
                "expected_duration": 4
            }
        ]
        
        logger.info("🎙️ Generating test audio suite...")
        generated_files = []
        
        for test_case in test_texts:
            filepath = self.generate_audio_file(
                test_case["text"], 
                test_case["filename"]
            )
            
            if filepath:
                generated_files.append({
                    **test_case,
                    "filepath": filepath
                })
                time.sleep(1)  # Brief pause between requests
        
        logger.info(f"✅ Generated {len(generated_files)} test audio files")
        return generated_files

def main():
    generator = AudioGenerator()
    
    # Check if Piper server is running by testing synthesis
    try:
        test_data = {
            "text": "test",
            "voice": "amy",
            "language": "en",
            "speed": 1.0
        }
        response = requests.post(f"{generator.piper_url}/synthesize/", json=test_data, timeout=10)
        if response.status_code != 200:
            logger.error(f"❌ Piper TTS server responded with status {response.status_code}")
            return
        logger.info("✅ Piper TTS server is responding correctly")
    except Exception as e:
        logger.error(f"❌ Cannot connect to Piper TTS server: {e}")
        logger.info("Make sure Piper TTS server is running on http://localhost:5100")
        return
    
    # Generate test audio files
    test_files = generator.generate_test_suite()
    
    if test_files:
        logger.info("\n📋 Generated Test Files:")
        for file_info in test_files:
            logger.info(f"  • {file_info['filename']}: '{file_info['text']}'")
    else:
        logger.error("❌ No audio files were generated")

if __name__ == "__main__":
    main()