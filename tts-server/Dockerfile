FROM python:3.10-slim

WORKDIR /app

# Install system dependencies and Piper TTS
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Download and install Piper TTS for Linux
RUN wget -O piper.tar.gz https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_amd64.tar.gz \
    && tar -xzf piper.tar.gz \
    && mv piper/piper /usr/local/bin/piper \
    && chmod +x /usr/local/bin/piper \
    && rm -rf piper.tar.gz piper

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code (excluding voice_samples directory)
COPY *.py ./
COPY config.py ./

# Create voice_samples directory and copy only English models
RUN mkdir -p voice_samples
COPY voice_samples/en_US-lessac-medium.onnx ./voice_samples/
COPY voice_samples/en_US-lessac-medium.onnx.json ./voice_samples/

# Expose port
EXPOSE 5100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:5100/')" || exit 1

# Run the application
CMD ["python", "piper_server.py"]
