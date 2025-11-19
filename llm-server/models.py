"""
Pydantic models for request/response validation
"""
from pydantic import BaseModel
from typing import List, Optional


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]
    language: str = "en"
    model: Optional[str] = None
    session_id: Optional[str] = None


class SessionResponse(BaseModel):
    session_id: str
    created_at: str
    message_count: int
