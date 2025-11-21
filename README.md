# Local Voice App

Python backend services for the Voice Assistant Next.js application.

## Project Structure

```
local-voice-app/
├── venv/                          # Python virtual environment
├── tts-server/                    # Text-to-Speech server
│   ├── piper_server_fixed.py
│   ├── voice_samples/
│   └── requirements.txt
├── stt-server/                    # Speech-to-Text server (future)
├── voice-assistant-nextjs/        # Next.js frontend
└── requirements.txt               # Shared Python dependencies
```

## Setup

1. **Create and activate virtual environment**:

Windows PowerShell:
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

Linux/Mac:
```bash
python -m venv venv
source venv/bin/activate
```

2. **Install dependencies**:
```bash
pip install -r requirements.txt
```

3. **Run TTS Server**:
```bash
cd tts-server
python piper_server.py
```

4. **Run Next.js App** (separate terminal):
```bash
cd voice-assistant-nextjs
npm install
npm run dev
```

## Services

### TTS Server (Port 5100)
Multi-language text-to-speech using Piper. See `tts-server/README.md` for details.

### STT Server (Port 5200)
Speech-to-text transcription service. Additionally the LLM server now exposes a faster-whisper endpoint (`/stt/fast`) for low-latency transcription.

#### Faster STT (LLM Server `/stt/fast`)
Configure the frontend to use the faster mode by setting:
```bash
NEXT_PUBLIC_FAST_STT_URL=http://localhost:11435/stt/fast
```
Optionally set default mode:
```bash
NEXT_PUBLIC_DEFAULT_STT_MODE=fast   # or 'original'
```
In the UI you can toggle between "Fast (faster-whisper)" and "Original" STT modes. The fast mode falls back automatically if the endpoint fails.

### Voice Assistant (Port 3000)
Next.js web application with VAD, streaming AI, and audio playback. See `voice-assistant-nextjs/README.md`.

## Dependencies

All Python dependencies are in `requirements.txt`. Install once in the virtual environment to use across both servers.
