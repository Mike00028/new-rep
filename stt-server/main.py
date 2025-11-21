
import concurrent.futures
import asyncio
import os
os.environ['KMP_DUPLICATE_LIB_OK']='True'

from faster_whisper import WhisperModel
from fastapi import FastAPI, UploadFile, File, HTTPException, Request, Form, Depends, status
from contextlib import asynccontextmanager
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Any, Union

# Constants
from constants import device, compute_type, security, MAX_THREADS

# Responses
from responses import SUCCESSFUL_RESPONSE, BAD_REQUEST_RESPONSE
from responses import VALIDATION_ERROR_RESPONSE, INTERNAL_SERVER_ERROR_RESPONSE

# Logging configuration
from logging_config import get_logger
logger = get_logger()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting up STT server...")
    yield
    # Shutdown
    logger.info("Shutting down STT server...")
    try:
        executor.shutdown(wait=True)
        logger.info("Thread pool shutdown completed")
    except Exception as e:
        logger.warning(f"Error during thread pool cleanup: {e}")

app = FastAPI(lifespan=lifespan)

# Create persistent thread pool for better performance
from concurrent.futures import ThreadPoolExecutor
executor = ThreadPoolExecutor(max_workers=MAX_THREADS)

# Model cache for performance optimization
model_cache = {}

def get_cached_model(model_name: str):
    """Get or create a cached model instance"""
    if model_name not in model_cache:
        logger.info(f"Loading model '{model_name}' into cache...")
        model_cache[model_name] = WhisperModel(model_name, device=device, compute_type=compute_type)
        logger.info(f"Model '{model_name}' loaded successfully")
    return model_cache[model_name]

# Pre-load the tiny model at startup for maximum speed
logger.info("Pre-loading tiny model for maximum speed...")
get_cached_model("tiny")
logger.info("Pre-loading base model for balanced performance...")
get_cached_model("distil-medium.en")

def process_file_sync(file_content: bytes, filename: str, model, initial_prompt: str, language: str, word_timestamps: bool, vad_filter: bool, min_silence_duration_ms: int):
    """Optimized synchronous file processing with minimal I/O overhead"""
    import tempfile
    import os
    from utils import get_file_extension, create_segment_data
    
    extension = get_file_extension(filename)
    
    # Use temporary file with optimized settings
    temp_file = tempfile.NamedTemporaryFile(suffix=extension, delete=False, buffering=0)
    try:
        # Write and flush immediately for faster access
        temp_file.write(file_content)
        temp_file.flush()
        os.fsync(temp_file.fileno())  # Ensure it's written to disk
        temp_file.close()
        
        # Transcribe with maximum speed optimization for base model
        vad_parameters = dict(min_silence_duration_ms=min_silence_duration_ms) if vad_filter else None
        segments, info = model.transcribe(
            temp_file.name, 
            initial_prompt=initial_prompt, 
            language=language, 
            beam_size=1,  # Fastest decoding
            best_of=1,    # Single pass
            temperature=0,  # Deterministic and faster
            vad_filter=vad_filter, 
            vad_parameters=vad_parameters, 
            word_timestamps=word_timestamps,
            condition_on_previous_text=False,  # Faster for short audio
            patience=1.0,  # Reduce patience for faster processing
            length_penalty=1.0  # No length penalty for speed
        )
        
        # Process segments efficiently
        segment_list = list(segments)
        segment_data = create_segment_data(segment_list, word_timestamps)
        full_text = " ".join([segment["text"] for segment in segment_data]).strip()
        
        return {
            "filename": filename,
            "detected_language": info.language,
            "language_probability": info.language_probability,
            "text": full_text,
            "segments": segment_data
        }
    finally:
        try:
            os.unlink(temp_file.name)
        except:
            pass  # Ignore cleanup errors for speed

origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper functions
from utils import authenticate_user
from utils import process_file, validate_parameters

# Routes
@app.get("/", response_class=RedirectResponse)
async def redirect_to_docs():
    return "/docs"

@app.get('/info')
def home():
    html_content = f"""
        <h1>FastWhisperAPI is running on <span style="color: blue;">{device}</span>!</h1>
        <p>Version: <strong>1.0</strong></p>
        <p>Author: <strong>Edoardo Cilia</strong></p>
        <p>License: <strong>Apache License 2.0</strong></p>
        <h2>Endpoints:</h2>
        <ul>
            <li>
                <h3>/v1/transcriptions</h3>
                <p>Method: POST</p>
                <p>Description: API designed to transcribe audio files leveraging the Faster Whisper library and FastAPI framework.</p>
                <h4>Parameters:</h4>
                <ul>
                    <li>file: A list of audio files to transcribe. This is a required parameter.</li>
                    <li>model: The size of the model to use for transcription. This is an optional parameter. The options are 'large', 'medium', 'small', 'base', 'tiny'. Default is 'base'.</li>
                    <li>language: This parameter specifies the language of the audio files. It is optional, with accepted values being lowercase ISO-639-1 format. (e.g., 'en' for English). If not provided, the system will automatically detect the language.</li>
                    <li>initial_prompt: This optional parameter provides an initial prompt to guide the model's transcription process. It can be used to pass a dictionary of the correct spellings of words and to provide context for better understanding speech, thus maintaining a consistent writing style.</li>
                    <li>vad_filter: Whether to apply a voice activity detection filter. This is an optional parameter. Default is False.</li>
                    <li>min_silence_duration_ms: The minimum duration of silence to be considered as a pause. This is an optional parameter. Default is 1000.</li>
                    <li>response_format: The format of the response. This is an optional parameter. The options are 'text', 'verbose_json'. Default is 'text'.</li>
                    <li>timestamp_granularities: The granularity of the timestamps. This is an optional parameter. The options are 'segment', 'word'. Default is 'segment'. This is a string and not an array like the OpenAI model, and the timestamps will be returned only if the response_format is set to verbose_json.</li>
                </ul>
                <h4>Example:</h4>
                <ul>
                    <li>file: audio1.wav, audio2.wav</li>
                    <li>model: base</li>
                    <li>language: en</li>
                    <li>initial_prompt: RoBERTa, Mixtral, Claude 3, Command R+, LLama 3.</li>
                    <li>vad_filter: False</li>
                    <li>min_silence_duration_ms: 1000</li>
                    <li>response_format: text</li>
                    <li>timestamp_granularities: segment</li>
                </ul>
                <h4>Example curl request:</h4>
                <ul style="list-style-type:none;">
                    <li>curl -X POST "http://localhost:5200
                    /v1/transcriptions" \\</li>
                    <li>-H  "accept: application/json" \\</li>
                    <li>-H  "Content-Type: multipart/form-data" \\</li>
                    <li>-F "file=@audio1.wav;type=audio/wav" \\</li>
                    <li>-F "file=@audio2.wav;type=audio/wav" \\</li>
                    <li>-F "model=base" \\</li>
                    <li>-F "language=en" \\</li>
                    <li>-F "initial_prompt=RoBERTa, Mixtral, Claude 3, Command R+, LLama 3." \\</li>
                    <li>-F "vad_filter=False" \\</li>
                    <li>-F "min_silence_duration_ms=1000" \\</li>
                    <li>-F "response_format=text" \\</li>
                    <li>-F "timestamp_granularities=segment"</li>
                </ul>
            </li>
            <li>
                <h3>/</h3>
                <p>Method: GET</p>
                <p>Description: Redirects to the /docs endpoint.</p>
            </li>
        </ul>
    """
    return HTMLResponse(content=html_content)
@app.post('/v1/transcriptions',
          responses={
              200: SUCCESSFUL_RESPONSE,
              400: BAD_REQUEST_RESPONSE,
              422: VALIDATION_ERROR_RESPONSE,
              500: INTERNAL_SERVER_ERROR_RESPONSE,
          }
)
async def transcribe_audio(credentials: HTTPAuthorizationCredentials = Depends(security),
                           file: List[UploadFile] = File(...),
                           model: str = Form("base"),
                           language: str = Form(None),
                           initial_prompt: str = Form(None),
                           vad_filter: bool = Form(False),
                           min_silence_duration_ms: int = Form(1000),
                           response_format: str = Form("text"),
                           timestamp_granularities: str = Form("segment")):
    
    logger.info(f"Received transcription request for {len(file)} file(s) using model: {model}")
    
    try:
        user = authenticate_user(credentials)
        validate_parameters(file, language, model, vad_filter, min_silence_duration_ms, response_format, timestamp_granularities)
        word_timestamps = timestamp_granularities == "word"
        
        # Get cached model instance for much better performance
        m = get_cached_model(model)
        
        # Process files using the optimized synchronous approach
        loop = asyncio.get_event_loop()
        futures = []
        
        for f in file:
            # Read file content first
            file_content = await f.read()
            # Reset file pointer for potential future reads
            await f.seek(0)
            
            # Submit to thread pool with optimized synchronous processing
            future = loop.run_in_executor(
                executor, 
                process_file_sync,
                file_content,
                f.filename or f"audio_{len(futures)+1}.wav",
                m,
                initial_prompt,
                language,
                word_timestamps,
                vad_filter,
                min_silence_duration_ms
            )
            futures.append(future)
        
        # Wait for all files to be processed concurrently
        results = await asyncio.gather(*futures, return_exceptions=True)
        
        # Process results
        transcriptions: Dict[str, Any] = {}
        for i, result in enumerate(results, start=1):
            if isinstance(result, Exception):
                logger.error(f"An error occurred during transcription of file {i}: {str(result)}")
                raise HTTPException(status_code=500, detail=f"Error processing file {i}: {str(result)}")
            
            # At this point, result is not an Exception, so it's the transcription dict
            transcription_result: Dict[str, Any] = result  # type: ignore[assignment]
            
            if len(file) > 1:
                if response_format == "text":
                    transcriptions[f"File {i}"] = {"text": transcription_result["text"]}
                else:
                    transcriptions[f"File {i}"] = transcription_result
            else:
                if response_format == "text":
                    transcriptions = {"text": transcription_result["text"]}
                else:
                    transcriptions = transcription_result
        
        logger.info(f"Transcription completed successfully for {len(file)} file(s).")
        return JSONResponse(content=transcriptions)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during transcription: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.detail,
    )
@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    status_code = 500
    error_type = type(exc).__name__
    if isinstance(exc, ValueError) or isinstance(exc, TypeError):
        status_code = 400
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "message": str(exc),
                "type": error_type,
                "param": "",
                "code": status_code
            }
        },
    )
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    details = exc.errors()[0]['msg']
    loc = exc.errors()[0]['loc']  
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "message": details,
                "type": "invalid_request_error",
                "param": loc[-1] if loc else "",
                "code": 422
            }
        },
    )



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5200)