"""
LangGraph workflow for LLM chat with memory
"""
import logging
from typing import Dict
from langchain_ollama import ChatOllama
from langchain_core.messages import SystemMessage, AIMessage
from langgraph.graph import START, MessagesState, StateGraph
from config import OLLAMA_BASE_URL, SYSTEM_PROMPTS
from conversation_memory import load_conversation_history, save_messages

logger = logging.getLogger(__name__)

# Cache workflows to reuse them (key: "model:language")
_workflow_cache: Dict[str, any] = {}


def get_workflow(model: str, language: str):
    """Get or create a cached workflow"""
    cache_key = f"{model}:{language}"
    
    if cache_key not in _workflow_cache:
        logger.info(f"Creating new workflow for {cache_key}")
        _workflow_cache[cache_key] = create_workflow(model, language)
    
    return _workflow_cache[cache_key]


def create_workflow(model: str, language: str):
    """Create a stateful workflow for conversation"""
    
    # Initialize Ollama model
    llm = ChatOllama(
        model=model,
        base_url=OLLAMA_BASE_URL,
        temperature=0.7
    )
    
    # Define system message based on language
    system_prompt = SYSTEM_PROMPTS.get(language, SYSTEM_PROMPTS["en"])
    
    def call_model(state: MessagesState):
        # Get existing messages from state
        messages = state["messages"]
        logger.info(f"call_model received {len(messages)} messages in state")
        
        # Log all messages for debugging
        for i, msg in enumerate(messages):
            msg_type = type(msg).__name__
            content_preview = str(msg.content)[:80] if hasattr(msg, 'content') else 'no content'
            logger.info(f"  Msg {i+1}: {msg_type} - {content_preview}...")
        
        # Keep only last 10 conversation messages (user + assistant pairs)
        # This limits context but keeps memory usage reasonable
        if len(messages) > 20:  # 20 messages = 10 conversation turns
            messages = messages[-20:]
            logger.info(f"Trimmed to last 20 messages (10 conversation turns)")
        
        # Add system message at the beginning if not present
        if not messages or not isinstance(messages[0], SystemMessage):
            messages = [SystemMessage(content=system_prompt)] + messages
            logger.info(f"Added system message. Total messages to LLM: {len(messages)}")
        
        # Get AI response using streaming (but collect full response)
        full_content = ""
        for chunk in llm.stream(messages):
            if hasattr(chunk, 'content') and chunk.content:
                content = chunk.content
                if isinstance(content, str):
                    full_content += content
                elif isinstance(content, list) and len(content) > 0:
                    full_content += str(content[0])
        
        # Return complete response
        response = AIMessage(content=full_content)
        return {"messages": [response]}
    
    # Build graph
    workflow = StateGraph(state_schema=MessagesState)
    workflow.add_node("model", call_model)
    workflow.set_entry_point("model")
    workflow.set_finish_point("model")
    
    # Compile without checkpointer (we'll handle memory manually)
    app = workflow.compile()
    return app
