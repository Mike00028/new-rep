# TTS Server - Piper Text-to-Speech

Multi-language text-to-speech server using Piper TTS with FastAPI.

## Features

- **Multi-language support**: English, Hindi (हिंदी), Telugu (తెలుగు)
- **Fast synthesis**: Using Piper's efficient ONNX models
- **REST API**: Simple HTTP API for text-to-speech conversion
- **CORS enabled**: Works with web applications
- **Streaming response**: Returns audio directly as WAV format

## Prerequisites

- Python 3.8 or higher
- Piper TTS binary (automatically downloaded)
- Voice model files (included in `voice_samples/`)

## Installation

### 1. Install Python Dependencies

```powershell
pip install -r requirements.txt
```

This installs:
- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `python-multipart` - File upload support

### 2. Download Piper Binary (Windows)

The Piper TTS binary is required to synthesize speech. Download and extract it:

```powershell
# Download Piper binary for Windows
Invoke-WebRequest -Uri "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip" -OutFile "piper.zip"

# Extract to current directory
Expand-Archive -Path "piper.zip" -DestinationPath "." -Force
```

This creates a `piper/` directory containing:
- `piper.exe` - Main executable
- `onnxruntime.dll` - Runtime library
- `espeak-ng-data/` - Phoneme data
- Other required DLLs

**For Linux/Mac:**
```bash
# Linux
wget https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
tar -xvzf piper_linux_x86_64.tar.gz

# macOS
wget https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_x64.tar.gz
tar -xvzf piper_macos_x64.tar.gz
```

### 3. Verify Voice Models

Ensure voice models are present in `voice_samples/`:

```
voice_samples/
├── en_US-lessac-medium.onnx       (English)
├── en_US-lessac-medium.onnx.json
├── hi_IN-priyamvada-medium.onnx   (Hindi)
├── hi_IN-priyamvada-medium.onnx.json
├── te_IN-padmavathi-medium.onnx   (Telugu)
└── te_IN-padmavathi-medium.onnx.json
```

## Running the Server

Start the TTS server on port 5100:

```powershell
python piper_server.py
```

The server will start at `http://localhost:5100`

You should see:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:5100
```

## API Usage

### Endpoint: POST `/synthesize/`

Synthesize speech from text.

**Request Body:**
```json
{
  "text": "Hello, how are you?",
  "language": "en"
}
```

**Parameters:**
- `text` (string, required): Text to synthesize
- `language` (string, optional): Language code - `"en"`, `"hi"`, or `"te"` (default: `"en"`)

**Response:**
- Content-Type: `audio/wav`
- Body: WAV audio file (16-bit, mono, 22050 Hz)

### Example with cURL

```bash
# English
curl -X POST "http://localhost:5100/synthesize/" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "language": "en"}' \
  --output output.wav

# Hindi
curl -X POST "http://localhost:5100/synthesize/" \
  -H "Content-Type: application/json" \
  -d '{"text": "नमस्ते दुनिया", "language": "hi"}' \
  --output output_hindi.wav

# Telugu
curl -X POST "http://localhost:5100/synthesize/" \
  -H "Content-Type: application/json" \
  -d '{"text": "హలో ప్రపంచం", "language": "te"}' \
  --output output_telugu.wav
```

### Example with JavaScript/Axios

```javascript
import axios from 'axios';

async function synthesizeSpeech(text, language = 'en') {
  const response = await axios.post('http://localhost:5100/synthesize/', {
    text: text,
    language: language
  }, {
    responseType: 'blob'
  });
  
  // Create audio URL
  const audioUrl = URL.createObjectURL(response.data);
  const audio = new Audio(audioUrl);
  audio.play();
}

// Usage
synthesizeSpeech("Hello, this is a test", "en");
synthesizeSpeech("नमस्ते", "hi");
synthesizeSpeech("హలో", "te");
```

## Supported Languages

| Language | Code | Model | Voice |
|----------|------|-------|-------|
| English | `en` | `en_US-lessac-medium` | Lessac (US) |
| Hindi | `hi` | `hi_IN-priyamvada-medium` | Priyamvada |
| Telugu | `te` | `te_IN-padmavathi-medium` | Padmavathi |

## Directory Structure

```
tts-server/
├── piper/                         # Piper binary and dependencies
│   ├── piper.exe                  # Main executable (Windows)
│   ├── onnxruntime.dll
│   ├── espeak-ng-data/
│   └── ...
├── voice_samples/                 # Voice models
│   ├── en_US-lessac-medium.onnx
│   ├── hi_IN-priyamvada-medium.onnx
│   └── te_IN-padmavathi-medium.onnx
├── piper_server.py                # FastAPI server
├── requirements.txt               # Python dependencies
└── README.md                      # This file
```

## Troubleshooting

### "Piper binary not found"
- Ensure `piper/piper.exe` (Windows) or `piper/piper` (Linux/Mac) exists
- Re-download and extract the binary
- Check file permissions on Linux/Mac: `chmod +x piper/piper`

### "Model file not found"
- Verify voice models are in `voice_samples/` directory
- Check the `.onnx` files exist for your language
- Download missing models from [Piper releases](https://github.com/rhasspy/piper/releases)

### "Unsupported language"
- Use valid language codes: `"en"`, `"hi"`, or `"te"`
- Add more languages by downloading models and updating `VOICE_MODELS` in `piper_server.py`

### Port already in use
```powershell
# Change port in piper_server.py (last line):
uvicorn.run(app, host="0.0.0.0", port=5100)  # Change 5100 to another port
```

## Development

To modify the server:

1. Edit `piper_server.py`
2. Add new language models to `voice_samples/`
3. Update `VOICE_MODELS` dictionary:
   ```python
   VOICE_MODELS = {
       "en": "./voice_samples/en_US-lessac-medium.onnx",
       "es": "./voice_samples/es_ES-yourmodel.onnx",  # Add Spanish
   }
   ```
4. Restart the server

## License

This server uses:
- **Piper TTS**: MIT License
- **FastAPI**: MIT License
- Voice models: Check individual model licenses

## Resources

- [Piper TTS GitHub](https://github.com/rhasspy/piper)
- [Available Voice Models](https://github.com/rhasspy/piper/blob/master/VOICES.md)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
