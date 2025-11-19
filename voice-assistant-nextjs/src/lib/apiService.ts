/**
 * API Service for Voice Assistant
 * Handles FastWhisper, LLM Server, and Piper TTS API calls
 */

import axios from 'axios';

// API Configuration - Uses environment variables for flexibility
const FAST_WHISPER_URL = process.env.NEXT_PUBLIC_FAST_WHISPER_URL || '/api/stt/v1/transcriptions';
const LLM_SERVER_URL = process.env.NEXT_PUBLIC_LLM_SERVER_URL || '/api/llm/chat/';
const PIPER_TTS_URL = process.env.NEXT_PUBLIC_PIPER_TTS_URL || '/api/tts/synthesize/';
const MODEL_NAME = process.env.NEXT_PUBLIC_MODEL_NAME || 'llama3.2';

// Session management URLs
const SESSION_CREATE_URL = process.env.NEXT_PUBLIC_SESSION_CREATE_URL || '/api/llm/session/create';
const SESSION_DELETE_URL = process.env.NEXT_PUBLIC_SESSION_DELETE_URL || '/api/llm/session';

// Console log environment variables for debugging
console.log('🔧 Environment Variables (Raw):');
console.log('process.env.NEXT_PUBLIC_FAST_WHISPER_URL:', process.env.NEXT_PUBLIC_FAST_WHISPER_URL);
console.log('process.env.NEXT_PUBLIC_LLM_SERVER_URL:', process.env.NEXT_PUBLIC_LLM_SERVER_URL);
console.log('process.env.NEXT_PUBLIC_PIPER_TTS_URL:', process.env.NEXT_PUBLIC_PIPER_TTS_URL);
console.log('process.env.NEXT_PUBLIC_SESSION_CREATE_URL:', process.env.NEXT_PUBLIC_SESSION_CREATE_URL);
console.log('process.env.NEXT_PUBLIC_SESSION_DELETE_URL:', process.env.NEXT_PUBLIC_SESSION_DELETE_URL);

console.log('🔧 API Service Configuration (Final URLs):');
console.log('FAST_WHISPER_URL:', FAST_WHISPER_URL);
console.log('LLM_SERVER_URL:', LLM_SERVER_URL);
console.log('PIPER_TTS_URL:', PIPER_TTS_URL);
console.log('SESSION_CREATE_URL:', SESSION_CREATE_URL);
console.log('SESSION_DELETE_URL:', SESSION_DELETE_URL);
console.log('MODEL_NAME:', MODEL_NAME);

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface TranscriptionResult {
  text: string;
  error?: string;
}

export interface StreamChunk {
  text: string;
  done: boolean;
  session_id?: string;
}

/**
 * Create a new chat session
 */
export async function createSession(language: string = 'en'): Promise<string> {
  try {
    const response = await axios.post(`${SESSION_CREATE_URL}?language=${language}`);
    return response.data.session_id;
  } catch (error) {
    console.error('Failed to create session:', error);
    throw error;
  }
}

/**
 * Delete a chat session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await axios.delete(`${SESSION_DELETE_URL}/${sessionId}`);
  } catch (error) {
    console.error('Failed to delete session:', error);
  }
}

/**
 * Transcribe audio using FastWhisper
 */
export async function transcribeAudio(audioBlob: Blob, language: string = 'en'): Promise<TranscriptionResult> {
  try {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', 'base');
    formData.append('language', language);
    formData.append('response_format', 'verbose_json');
    
    const response = await axios.post(FAST_WHISPER_URL, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'Authorization': 'Bearer dummy_api_key',
      },
      timeout: 30000,
    });
    
    return { text: response.data.text };
  } catch (error) {
    console.error('Transcription error:', error);
    return { text: '', error: 'Transcription failed' };
  }
}

/**
 * Generate chat completion with streaming support via LLM Server
 */
export async function* generateChatStream(
  messages: Message[],
  language: string = 'en',
  sessionId?: string,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk, void, unknown> {
  try {
    const response = await fetch(LLM_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: messages,
        language: language,
        model: MODEL_NAME,
        session_id: sessionId,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No reader available');
    }

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        yield { text: '', done: true };
        break;
      }

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        // SSE format: "data: {...}"
        if (line.startsWith('data: ')) {
          try {
            const jsonStr = line.substring(6); // Remove "data: " prefix
            const data = JSON.parse(jsonStr);
            
            if (data.error) {
              console.error('LLM Server error:', data.error);
              throw new Error(data.error);
            }
            
            if (data.text) {
              yield {
                text: data.text,
                done: data.done || false,
              };
            }
            
            if (data.done) {
              yield { text: '', done: true };
              return;
            }
          } catch (e) {
            console.error('Error parsing SSE data:', e);
          }
        }
      }
    }
  } catch (error) {
    console.error('Chat stream error:', error);
    throw error;
  }
}

/**
 * Generate TTS audio from text
 */
export async function synthesizeSpeech(text: string, language: string = 'en'): Promise<Blob | null> {
  try {
    const response = await axios.post(
      PIPER_TTS_URL,
      {
        text: text,
        language: language,
      },
      {
        responseType: 'blob',
        timeout: 30000,
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('TTS error:', error);
    return null;
  }
}

/**
 * Create audio URL from blob
 */
export function createAudioUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/**
 * Revoke audio URL to free memory
 */
export function revokeAudioUrl(url: string): void {
  URL.revokeObjectURL(url);
}
