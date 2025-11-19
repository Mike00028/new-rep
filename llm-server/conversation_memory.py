"""
Simple SQLite-based conversation memory for storing message history.
"""
import sqlite3
from pathlib import Path
from typing import List, Dict
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage

# Database path
DB_PATH = Path(__file__).parent / "conversations.db"


def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_session_id 
        ON messages(session_id, timestamp)
    """)
    
    conn.commit()
    conn.close()


def load_conversation_history(session_id: str) -> List[BaseMessage]:
    """
    Load conversation history for a session.
    
    Args:
        session_id: The session identifier
        
    Returns:
        List of LangChain message objects
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT role, content FROM messages
        WHERE session_id = ?
        ORDER BY timestamp ASC
    """, (session_id,))
    
    rows = cursor.fetchall()
    conn.close()
    
    messages = []
    for role, content in rows:
        if role == "human":
            messages.append(HumanMessage(content=content))
        elif role == "ai":
            messages.append(AIMessage(content=content))
    
    return messages


def save_messages(session_id: str, messages: List[BaseMessage]):
    """
    Save new messages to the database.
    
    Args:
        session_id: The session identifier
        messages: List of messages to save (typically the new human and AI messages)
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    for message in messages:
        role = "human" if isinstance(message, HumanMessage) else "ai"
        cursor.execute("""
            INSERT INTO messages (session_id, role, content)
            VALUES (?, ?, ?)
        """, (session_id, role, message.content))
    
    conn.commit()
    conn.close()


def clear_conversation(session_id: str):
    """
    Clear all messages for a session.
    
    Args:
        session_id: The session identifier
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
    
    conn.commit()
    conn.close()


# Initialize database on module import
init_db()
