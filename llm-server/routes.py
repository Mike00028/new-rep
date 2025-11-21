"""
FastAPI routes for LLM server
"""
import json
import uuid
import logging
from datetime import datetime
from fastapi import HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, AIMessage

from models import ChatRequest, SessionResponse
from session_manager import sessions, delete_session_file
from workflow import get_workflow
from conversation_memory import load_conversation_history, save_messages
from config import DEFAULT_MODEL
from stt_fast import transcribe_audio_bytes

logger = logging.getLogger(__name__)


def get_root():
    """Root endpoint with server info"""
    return {
        "service": "LLM Server with Memory",
        "status": "running",
        "default_model": DEFAULT_MODEL,
        "active_sessions": len(sessions),
    }


def create_session_endpoint(language: str = "en") -> SessionResponse:
    """Create a new conversation session"""
    session_id = str(uuid.uuid4())
    session_data = {
        "created_at": datetime.now().isoformat(),
        "language": language,
        "message_count": 0,
        "messages": [],  # Store conversation history
    }
    sessions[session_id] = session_data
    
    logger.info(f"Created new session: {session_id}")
    return SessionResponse(
        session_id=session_id,
        created_at=sessions[session_id]["created_at"],
        message_count=0,
    )


def get_session_endpoint(session_id: str) -> SessionResponse:
    """Get session information"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = sessions[session_id]
    return SessionResponse(
        session_id=session_id,
        created_at=session["created_at"],
        message_count=session["message_count"],
    )


def get_session_messages_endpoint(session_id: str):
    """Get all messages in a session"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = sessions[session_id]
    return {
        "session_id": session_id,
        "message_count": len(session.get("messages", [])),
        "messages": session.get("messages", [])
    }


def delete_session_endpoint(session_id: str):
    """Delete a session and its memory"""
    if session_id in sessions:
        del sessions[session_id]
        # Delete from file system
        delete_session_file(session_id)
        logger.info(f"Deleted session: {session_id}")
        return {"message": "Session deleted"}
    raise HTTPException(status_code=404, detail="Session not found")


async def fast_stt_endpoint(
    file: UploadFile = File(...),
    language: str | None = Form(None),
    task: str = Form("transcribe"),
):
    """High-speed speech-to-text using faster-whisper.

    Accepts an audio file (wav/mp3/ogg/webm) and returns JSON transcription.
    Parameters:
      language: optional language code (e.g. 'en'); if omitted model auto-detects.
      task: 'transcribe' (default) or 'translate'.
    """
    try:
        if file is None:
            raise HTTPException(status_code=400, detail="No file provided")
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty file")
        result = transcribe_audio_bytes(data, language=language, task=task)
        return {
            "text": result["text"],
            "language": result["language"],
            "segments": result["segments"],
            "model": "faster-whisper",
            "task": task,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Fast STT error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


async def chat_stream_endpoint(request: ChatRequest):
    """
    Stream chat completions with conversation memory
    """
    # Create or retrieve session
    session_id = request.session_id or str(uuid.uuid4())
    
    if session_id not in sessions:
        session_data = {
            "created_at": datetime.now().isoformat(),
            "language": request.language,
            "message_count": 0,
            "messages": [],  # Store conversation history
        }
        sessions[session_id] = session_data
        logger.info(f"Created new session: {session_id}")
    
    logger.info(f"Chat request - Session: {session_id}, Language: {request.language}, Model: {request.model}, Messages: {len(request.messages)}")
    
    # Get cached workflow
    model = request.model or DEFAULT_MODEL
    app = get_workflow(model, request.language)
    
    # Load conversation history from database
    conversation_history = load_conversation_history(session_id)
    logger.info(f"Loaded {len(conversation_history)} messages from database for session {session_id}")
    
    # Convert request messages to LangChain format (only new messages)
    new_messages = []
    for msg in request.messages:
        if msg.role == "user":
            new_messages.append(HumanMessage(content=msg.content))
            # Save user message immediately
            sessions[session_id]["messages"].append({
                "role": "user",
                "content": msg.content,
                "timestamp": datetime.now().isoformat()
            })
            logger.info(f"Saved user message to session {session_id}")
        elif msg.role == "assistant":
            new_messages.append(AIMessage(content=msg.content))
    
    # Combine history + new messages for context
    all_messages = conversation_history + new_messages
    logger.info(f"Total context: {len(all_messages)} messages ({len(conversation_history)} from history + {len(new_messages)} new)")
    
    
    async def generate():
        try:
            # Import LLM directly for true token streaming
            from langchain_ollama import ChatOllama
            from langchain_core.messages import SystemMessage
            from config import OLLAMA_BASE_URL, SYSTEM_PROMPTS
            
            # Initialize LLM for direct streaming
            llm = ChatOllama(
                model=model,
                base_url=OLLAMA_BASE_URL,
                temperature=0.7,
            )
            
            # Limit context and add system message
            streaming_messages = all_messages
            if len(streaming_messages) > 20:
                streaming_messages = streaming_messages[-20:]
                logger.info(f"Trimmed to last 20 messages for streaming")
            
            # Add system message if not present
            system_prompt = SYSTEM_PROMPTS.get(request.language, SYSTEM_PROMPTS["en"])
            if not streaming_messages or not isinstance(streaming_messages[0], SystemMessage):
                streaming_messages = [SystemMessage(content=system_prompt)] + streaming_messages
            
            full_response = ""
            
            logger.info(f"Starting TRUE token-level streaming for session {session_id}")
            
            # TRUE token-level streaming directly from LLM
            async for chunk in llm.astream(streaming_messages):
                if hasattr(chunk, 'content') and chunk.content:
                    content = chunk.content
                    if isinstance(content, str) and content:
                        full_response += content
                        # Yield each token as it arrives
                        yield f"data: {json.dumps({'text': content, 'done': False, 'session_id': session_id})}\n\n"
            
            # Save both user and AI messages to database
            if full_response:
                ai_message = AIMessage(content=full_response)
                save_messages(session_id, new_messages + [ai_message])
                logger.info(f"Saved {len(new_messages) + 1} messages to database for session {session_id}")
                
                # Also save AI response to session file
                sessions[session_id]["messages"].append({
                    "role": "assistant",
                    "content": full_response,
                    "timestamp": datetime.now().isoformat()
                })
                logger.info(f"Saved AI response to session {session_id}")
                
            
            # Send final done message
            sessions[session_id]["message_count"] += 1
            yield f"data: {json.dumps({'text': '', 'done': True, 'session_id': session_id})}\n\n"
            logger.info(f"Chat stream completed for session: {session_id}. Total messages: {len(sessions[session_id]['messages'])}")
            
        except Exception as e:
            logger.error(f"Chat stream error: {str(e)}", exc_info=True)
            yield f"data: {json.dumps({'error': str(e), 'session_id': session_id})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Session-ID": session_id,
        }
    )


