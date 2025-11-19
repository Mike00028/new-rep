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
Speech-to-text transcription service (currently using external FastWhisper API).

### Voice Assistant (Port 3000)
Next.js web application with VAD, streaming AI, and audio playback. See `voice-assistant-nextjs/README.md`.

## Dependencies

All Python dependencies are in `requirements.txt`. Install once in the virtual environment to use across both servers.
