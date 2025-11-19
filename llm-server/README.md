# LLM Server - Ollama Chat API

FastAPI server to handle Ollama chat requests with streaming support.

## Installation

```powershell
pip install fastapi uvicorn httpx
```

## Running the Server

```powershell
python ollama_server.py
```

Server will start on `http://localhost:11435`

## API Endpoint

### POST `/chat/`

Stream chat completions from Ollama.

**Request:**
```json
{
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "language": "en",
  "model": "llama3.2"
}
```

**Response:** Server-Sent Events (SSE) stream
