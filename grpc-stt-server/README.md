# gRPC STT Server

A high-performance Speech-to-Text server built with gRPC and Faster Whisper.

## Features

- **gRPC API**: High-performance, language-agnostic API
- **Faster Whisper**: Optimized Whisper implementation with faster inference
- **Multiple Models**: Support for various Whisper model sizes
- **Streaming Support**: Real-time streaming transcription
- **Multi-language**: Support for 100+ languages
- **Word Timestamps**: Precise word-level timing information
- **GPU Acceleration**: CUDA support for faster processing

## Quick Start

### Prerequisites

- Python 3.8+
- Virtual environment recommended

### Installation

1. Clone or navigate to the grpc-stt-server directory
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Generate protobuf files (if not already generated):
   ```bash
   python -m grpc_tools.protoc --proto_path=protos --python_out=generated --grpc_python_out=generated protos/stt.proto
   ```

### Running the Server

```bash
python server.py
```

The server will start on `localhost:50051` by default.

### Testing the Client

```bash
python client.py
```

## Configuration

Environment variables can be set in the `.env` file or as system environment variables:

- `GRPC_PORT`: Server port (default: 50051)
- `DEFAULT_MODEL`: Default Whisper model (default: distil-large-v2)
- `FORCE_CPU`: Force CPU usage (default: false)
- `MAX_THREADS`: Maximum threads for processing (default: 6)
- `MAX_WORKERS`: Maximum gRPC workers (default: 10)

## API Reference

### Service: SpeechToText

#### Methods

1. **Transcribe**: Single audio file transcription
   - Input: `TranscribeRequest`
   - Output: `TranscribeResponse`

2. **StreamingTranscribe**: Real-time streaming transcription
   - Input: Stream of `StreamingTranscribeRequest`
   - Output: Stream of `StreamingTranscribeResponse`

3. **GetCapabilities**: Get server capabilities
   - Input: `CapabilitiesRequest`
   - Output: `CapabilitiesResponse`

### Supported Models

- tiny.en, tiny
- base.en, base
- small.en, small
- medium.en, medium
- large-v1, large-v2, large-v3, large
- distil-large-v2, distil-medium.en, distil-small.en, distil-large-v3

### Supported Languages

Supports 100+ languages including English, Spanish, French, German, Chinese, Japanese, and many more.

### Supported Audio Formats

- WAV, MP3, MP4, FLAC, OGG, WEBM, OPUS, M4A, and more

## Example Usage

### Python Client

```python
from client import STTClient

# Create client
client = STTClient('localhost:50051')
client.connect()

# Transcribe a file
result = client.transcribe_file('audio.wav', model='base', word_timestamps=True)
if result and result.success:
    print(f"Transcription: {result.text}")
    print(f"Language: {result.language}")
    print(f"Duration: {result.duration:.2f}s")

client.close()
```

### Command Line Testing (using grpcurl)

First install grpcurl:
```bash
# Windows (using Chocolatey)
choco install grpcurl

# Or download from: https://github.com/fullstorydev/grpcurl/releases
```

Then test the server:
```bash
# Get capabilities
grpcurl -plaintext localhost:50051 stt.SpeechToText/GetCapabilities

# Transcribe (you'll need to encode audio as base64)
grpcurl -plaintext -d '{"audio_data": "base64_encoded_audio", "model": "base"}' localhost:50051 stt.SpeechToText/Transcribe
```

## Performance

- **CPU**: Works on any CPU, optimized for modern processors
- **GPU**: CUDA acceleration for significant speed improvements
- **Memory**: Model sizes range from ~40MB (tiny) to ~3GB (large)
- **Throughput**: Depends on model size and hardware, typically faster than real-time

## Error Handling

The server provides detailed error messages for:
- Unsupported models or languages
- Invalid audio data
- Server configuration issues
- Processing errors

## Project Structure

```
grpc-stt-server/
├── protos/
│   └── stt.proto              # Protocol Buffer definitions
├── generated/
│   ├── stt_pb2.py            # Generated Python protobuf classes
│   └── stt_pb2_grpc.py       # Generated gRPC service stubs
├── server.py                  # Main gRPC server implementation
├── client.py                  # Sample gRPC client
├── requirements.txt           # Python dependencies
├── .env                       # Configuration file
└── README.md                 # Documentation
```

## Integration

This gRPC server can be easily integrated into:
- Web applications (via gRPC-Web)
- Mobile applications
- Microservices architectures
- Voice assistants and chatbots
- Real-time transcription systems

## Development

To regenerate protobuf files after modifying `stt.proto`:
```bash
python -m grpc_tools.protoc --proto_path=protos --python_out=generated --grpc_python_out=generated protos/stt.proto
```

## Notes

- The server automatically downloads the specified Whisper model on first use
- Models are cached for subsequent requests
- GPU acceleration is automatically enabled if CUDA is available
- Server logs include timing and performance information