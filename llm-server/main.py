"""
LLM Server - Ollama Chat API with Memory
Main entry point for the FastAPI application
"""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from routes import (
    get_root,
    create_session_endpoint,
    get_session_endpoint,
    get_session_messages_endpoint,
    delete_session_endpoint,
    chat_stream_endpoint
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(title="LLM Server - Ollama Chat API with Memory")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.get("/")(get_root)
app.post("/session/create")(create_session_endpoint)
app.get("/session/{session_id}")(get_session_endpoint)
app.get("/session/{session_id}/messages")(get_session_messages_endpoint)
app.delete("/session/{session_id}")(delete_session_endpoint)
app.post("/chat/")(chat_stream_endpoint)


if __name__ == "__main__":
    logger.info("Starting LLM Server on port 11435")
    uvicorn.run(app, host="0.0.0.0", port=11435)
