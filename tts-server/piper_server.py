"""
TTS Server using Piper with concurrent request handling
"""
import os
import subprocess
import uuid
import logging
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import PIPER_EXECUTABLE, VOICE_MODELS, HOST, PORT

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Thread pool for handling concurrent TTS requests
executor = ThreadPoolExecutor(max_workers=8)

class TTSRequest(BaseModel):
    text: str
    language: str = "en"

class CleanupFileResponse(FileResponse):
    """FileResponse that deletes the file after sending"""
    def __init__(self, path, *args, **kwargs):
        super().__init__(path, *args, **kwargs)
        self.file_path = path
    
    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            # Clean up the temporary file
            try:
                if os.path.exists(self.file_path):
                    os.remove(self.file_path)
                    logger.info(f"Cleaned up temporary file: {self.file_path}")
            except Exception as e:
                logger.error(f"Failed to clean up file {self.file_path}: {e}")

def generate_audio(text: str, language: str = "en") -> str:
    """
    Generate audio using Piper TTS synchronously.
    Returns the path to the generated audio file.
    """
    try:
        # Get the voice model for the specified language
        if language not in VOICE_MODELS:
            raise ValueError(f"Unsupported language: {language}")
        
        voice_model = VOICE_MODELS[language]
        
        # Generate unique output filename to avoid conflicts
        output_file = f"output_{uuid.uuid4().hex}.wav"
        
        # Construct the Piper command
        cmd = [
            PIPER_EXECUTABLE,
            "--model", voice_model,
            "--output_file", output_file
        ]
        
        logger.info(f"Running Piper command: {' '.join(cmd)}")
        logger.info(f"Input text: {text[:100]}...")  # Log first 100 chars
        
        # Run Piper with text input
        result = subprocess.run(
            cmd,
            input=text,
            text=True,
            capture_output=True,
            check=True
        )
        
        logger.info(f"Piper completed successfully. Output: {result.stdout}")
        
        # Verify output file was created
        if not os.path.exists(output_file):
            raise RuntimeError(f"Output file {output_file} was not created")
        
        return output_file
        
    except subprocess.CalledProcessError as e:
        logger.error(f"Piper command failed: {e}")
        logger.error(f"Stderr: {e.stderr}")
        # Clean up partial file if it exists
        if 'output_file' in locals() and os.path.exists(output_file):
            os.remove(output_file)
        raise RuntimeError(f"TTS generation failed: {e.stderr}")
    except Exception as e:
        logger.error(f"Error in generate_audio: {e}")
        # Clean up partial file if it exists
        if 'output_file' in locals() and os.path.exists(output_file):
            os.remove(output_file)
        raise

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle"""
    logger.info("Starting TTS server...")
    logger.info(f"Using Piper executable: {PIPER_EXECUTABLE}")
    logger.info(f"Available voice models: {list(VOICE_MODELS.keys())}")
    
    # Verify Piper executable exists
    if not Path(PIPER_EXECUTABLE).exists() and PIPER_EXECUTABLE != "piper":
        logger.warning(f"Piper executable not found at: {PIPER_EXECUTABLE}")
    
    yield
    
    # Shutdown
    logger.info("Shutting down TTS server...")
    executor.shutdown(wait=False)

# Create FastAPI app with lifespan
app = FastAPI(title="Piper TTS Server", lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

@app.get("/")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Piper TTS Server",
        "piper_executable": PIPER_EXECUTABLE,
        "available_languages": list(VOICE_MODELS.keys())
    }

@app.post("/synthesize/")
async def synthesize_speech(request: TTSRequest):
    """
    Synthesize speech from text using Piper TTS
    """
    try:
        logger.info(f"Received TTS request - Language: {request.language}, Text length: {len(request.text)}")
        
        # Validate input
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")
        
        if request.language not in VOICE_MODELS:
            raise HTTPException(
                status_code=400, 
                detail=f"Unsupported language: {request.language}. Available: {list(VOICE_MODELS.keys())}"
            )
        
        # Run TTS generation in thread pool to avoid blocking
        import asyncio
        loop = asyncio.get_event_loop()
        output_file = await loop.run_in_executor(
            executor, 
            generate_audio, 
            request.text, 
            request.language
        )
        
        logger.info(f"TTS generation completed: {output_file}")
        
        # Return the audio file (will be cleaned up after sending)
        return CleanupFileResponse(
            output_file,
            media_type="audio/wav",
            filename=f"tts_output_{request.language}.wav"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in synthesize_speech: {e}")
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")