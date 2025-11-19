"""
Interactive conversation memory test - Ask questions and see memory in action
"""
import asyncio
from conversation_memory import (
    load_conversation_history, 
    save_messages, 
    clear_conversation,
    DB_PATH
)
from langchain_core.messages import HumanMessage, AIMessage
from workflow import get_workflow

async def interactive_chat():
    """Interactive chat to test conversation memory"""
    
    session_id = "interactive_test_session"
    
    print("\n" + "="*60)
    print("Interactive Conversation Memory Test")
    print("="*60)
    print(f"\nSession ID: {session_id}")
    print(f"Database: {DB_PATH}")
    
    # Ask if user wants to clear history
    clear_input = input("\nClear previous conversation history? (y/n): ").strip().lower()
    if clear_input == 'y':
        clear_conversation(session_id)
        print("✓ Conversation history cleared")
    
    # Load existing history
    history = load_conversation_history(session_id)
    print(f"\nLoaded {len(history)} messages from database")
    
    if len(history) > 0:
        print("\nPrevious conversation:")
        for i, msg in enumerate(history, 1):
            role = "You" if isinstance(msg, HumanMessage) else "AI"
            content = msg.content[:100] + "..." if len(msg.content) > 100 else msg.content
            print(f"  {i}. {role}: {content}")
    
    # Get workflow
    print("\nInitializing LLM...")
    app = get_workflow("llama3.2", "en")
    print("✓ Ready!\n")
    
    print("="*60)
    print("Type your questions (type 'quit' or 'exit' to stop)")
    print("Try asking about previous questions to test memory!")
    print("="*60 + "\n")
    
    turn = 1
    while True:
        # Get user input
        user_input = input(f"\nTurn {turn} - You: ").strip()
        
        if user_input.lower() in ['quit', 'exit', 'q']:
            print("\nGoodbye! Your conversation has been saved.")
            break
        
        if not user_input:
            continue
        
        # Load latest history
        history = load_conversation_history(session_id)
        
        # Create user message
        user_msg = HumanMessage(content=user_input)
        all_messages = history + [user_msg]
        
        print(f"\n[Loading from DB: {len(history)} messages]")
        print(f"[Total context: {len(all_messages)} messages]")
        print("\nAI: ", end="", flush=True)
        
        # Stream response
        response_text = ""
        try:
            async for chunk in app.astream({"messages": all_messages}, stream_mode="values"):
                if "messages" in chunk and len(chunk["messages"]) > 0:
                    last_message = chunk["messages"][-1]
                    if isinstance(last_message, AIMessage):
                        new_text = last_message.content
                        if new_text != response_text:
                            delta = new_text[len(response_text):]
                            print(delta, end="", flush=True)
                            response_text = new_text
        except Exception as e:
            print(f"\n\n❌ Error: {e}")
            continue
        
        print()  # New line after response
        
        # Save to database
        if response_text:
            ai_msg = AIMessage(content=response_text)
            save_messages(session_id, [user_msg, ai_msg])
            print(f"\n[Saved to database: +2 messages, Total: {len(history) + 2}]")
        
        turn += 1

if __name__ == "__main__":
    try:
        asyncio.run(interactive_chat())
    except KeyboardInterrupt:
        print("\n\nInterrupted. Conversation saved.")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
