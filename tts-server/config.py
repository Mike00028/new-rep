"""
Configuration settings for the TTS server
"""
import os
import platform
from pathlib import Path

# Detect operating system and set appropriate Piper executable
def get_piper_executable():
    """Get the appropriate Piper executable based on the operating system"""
    system = platform.system().lower()
    
    if system == "windows":
        # Windows - use local piper.exe
        return "./piper/piper.exe"
    elif system == "linux":
        # Linux (Docker) - use piper installed in PATH
        return "piper"
    elif system == "darwin":
        # macOS - use piper installed in PATH
        return "piper"
    else:
        # Default to Linux behavior
        return "piper"

# Piper Configuration
PIPER_EXECUTABLE = get_piper_executable()

# Voice models mapping (only English model for Docker deployment)
VOICE_MODELS = {
    "en": "./voice_samples/en_US-lessac-medium.onnx",
    # Uncomment below for local development with all models
    # "hi": "./voice_samples/hi_IN-priyamvada-medium.onnx",
    # "te": "./voice_samples/te_IN-padmavathi-medium.onnx",
}

# Output configuration (now using dynamic file names)
# OUTPUT_FILE = "output.wav"  # Removed - now using unique files per request

# Server configuration
HOST = "0.0.0.0"
PORT = 5100

# Logging configuration
LOG_LEVEL = "INFO"

# Health check endpoint
HEALTH_CHECK_ENDPOINT = f"http://localhost:{PORT}/"