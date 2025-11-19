"""
Session management utilities for storing conversation history
"""
import json
import logging
from typing import Optional, Dict
from pathlib import Path
from config import CONVERSATIONS_DIR

logger = logging.getLogger(__name__)

# In-memory session storage
sessions: Dict[str, dict] = {}


def save_session_to_file(session_id: str, session_data: dict):
    """Save session data to a JSON file"""
    try:
        file_path = CONVERSATIONS_DIR / f"{session_id}.json"
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(session_data, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved session {session_id} to {file_path}")
    except Exception as e:
        logger.error(f"Error saving session {session_id}: {e}")


def load_session_from_file(session_id: str) -> Optional[dict]:
    """Load session data from a JSON file"""
    try:
        file_path = CONVERSATIONS_DIR / f"{session_id}.json"
        if file_path.exists():
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        logger.error(f"Error loading session {session_id}: {e}")
    return None


def delete_session_file(session_id: str):
    """Delete session file"""
    try:
        file_path = CONVERSATIONS_DIR / f"{session_id}.json"
        if file_path.exists():
            file_path.unlink()
            logger.info(f"Deleted session file {file_path}")
    except Exception as e:
        logger.error(f"Error deleting session file {session_id}: {e}")
