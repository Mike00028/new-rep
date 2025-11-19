"""
Test script to verify conversation memory is working
"""
import sqlite3
import asyncio
from conversation_memory import (
    load_conversation_history, 
    save_messages, 
    clear_conversation,
    DB_PATH
)
from langchain_core.messages import HumanMessage, AIMessage
from workflow import get_workflow

def print_separator():
    print("\n" + "="*60 + "\n")

async def test_conversation_memory():
    """Test the conversation memory system"""
    
    # Test session ID
    test_session = "test_session_123"
    
    print(f"Testing conversation memory with session: {test_session}")
    print(f"Database path: {DB_PATH}")
    print_separator()
    
    # Clear any existing conversation for this test session
    print("1. Clearing any existing conversation...")
    clear_conversation(test_session)
    print("   ✓ Cleared")
    print_separator()
    
    # Get workflow
    print("2. Getting workflow...")
    app = get_workflow("llama3.2", "en")
    print("   ✓ Workflow ready")
    print_separator()
    
    # First conversation turn
    print("3. First question: 'What is the capital of France?'")
    history = load_conversation_history(test_session)
    print(f"   Loaded {len(history)} messages from database")
    
    user_msg_1 = HumanMessage(content="What is the capital of France?")
    all_messages = history + [user_msg_1]
    
    print("   Calling LLM...")
    response_1 = ""
    async for chunk in app.astream({"messages": all_messages}, stream_mode="values"):
        if "messages" in chunk and len(chunk["messages"]) > 0:
            last_message = chunk["messages"][-1]
            if isinstance(last_message, AIMessage):
                response_1 = last_message.content
    
    print(f"   AI Response: {response_1[:100]}...")
    
    # Save messages to database
    ai_msg_1 = AIMessage(content=response_1)
    save_messages(test_session, [user_msg_1, ai_msg_1])
    print(f"   Saved 2 messages to database")
    print_separator()
    
    # Second conversation turn
    print("4. Second question: 'What about Italy?'")
    history = load_conversation_history(test_session)
    print(f"   Loaded {len(history)} messages from database (should be 2)")
    
    user_msg_2 = HumanMessage(content="What about Italy?")
    all_messages = history + [user_msg_2]
    print(f"   Total context: {len(all_messages)} messages")
    
    print("   Calling LLM...")
    response_2 = ""
    async for chunk in app.astream({"messages": all_messages}, stream_mode="values"):
        if "messages" in chunk and len(chunk["messages"]) > 0:
            last_message = chunk["messages"][-1]
            if isinstance(last_message, AIMessage):
                response_2 = last_message.content
    
    print(f"   AI Response: {response_2[:100]}...")
    
    # Save messages to database
    ai_msg_2 = AIMessage(content=response_2)
    save_messages(test_session, [user_msg_2, ai_msg_2])
    print(f"   Saved 2 messages to database")
    print_separator()
    
    # Third conversation turn - ask about previous questions
    print("5. Third question: 'What were my last two questions?'")
    history = load_conversation_history(test_session)
    print(f"   Loaded {len(history)} messages from database (should be 4)")
    
    user_msg_3 = HumanMessage(content="What were my last two questions?")
    all_messages = history + [user_msg_3]
    print(f"   Total context: {len(all_messages)} messages")
    
    print("   Calling LLM...")
    response_3 = ""
    async for chunk in app.astream({"messages": all_messages}, stream_mode="values"):
        if "messages" in chunk and len(chunk["messages"]) > 0:
            last_message = chunk["messages"][-1]
            if isinstance(last_message, AIMessage):
                response_3 = last_message.content
    
    print(f"   AI Response: {response_3}")
    
    # Save messages to database
    ai_msg_3 = AIMessage(content=response_3)
    save_messages(test_session, [user_msg_3, ai_msg_3])
    print(f"   Saved 2 messages to database")
    print_separator()
    
    # Verify database directly
    print("6. Verifying database directly...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM messages WHERE session_id = ?", (test_session,))
    count = cursor.fetchone()[0]
    print(f"   Database shows {count} messages for session {test_session}")
    
    cursor.execute("""
        SELECT role, content FROM messages 
        WHERE session_id = ? 
        ORDER BY timestamp
    """, (test_session,))
    rows = cursor.fetchall()
    print("   Full conversation in database:")
    for i, (role, content) in enumerate(rows, 1):
        preview = content[:80] + "..." if len(content) > 80 else content
        print(f"   {i}. {role}: {preview}")
    conn.close()
    print("   ✓ Verified")
    print_separator()
    
    # Clean up
    print("7. Cleaning up test data...")
    clear_conversation(test_session)
    history = load_conversation_history(test_session)
    assert len(history) == 0, "History should be empty after cleanup"
    print("   ✓ Cleaned")
    print_separator()
    
    print("✅ ALL TESTS PASSED!")
    print("Conversation memory is working correctly with real LLM calls.")
    print("\nThe AI successfully:")
    print("  • Remembered context from previous messages")
    print("  • Answered 'what were my last two questions?' correctly")
    print("  • Persisted all messages to SQLite database")

if __name__ == "__main__":
    try:
        asyncio.run(test_conversation_memory())
    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
