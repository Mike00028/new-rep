// gRPC TTS Service for Next.js
// Interfaces with the gRPC TTS server for high-performance text-to-speech

import { ensureWavFormat } from './wavUtils';

interface GrpcTTSRequest {
  text: string;
  voice?: string;
  language?: string;
  speed?: number;
  pitch?: number;
  outputFormat?: string;
  sampleRate?: number;
}

interface GrpcTTSResponse {
  audioData: Uint8Array;
  duration: number;
  sampleRate: number;
  format: string;
  success: boolean;
  errorMessage?: string;
}

interface GrpcVoice {
  name: string;
  language: string;
  gender: string;
  quality: string;
  sampleRates: number[];
}

interface GrpcVoicesResponse {
  voices: GrpcVoice[];
  success: boolean;
  errorMessage?: string;
}

class GrpcTTSService {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  /**
   * Synthesize speech using gRPC TTS server
   */
  async synthesize(
    text: string,
    options: {
      voice?: string;
      language?: string;
      speed?: number;
      pitch?: number;
      outputFormat?: string;
      sampleRate?: number;
    } = {}
  ): Promise<GrpcTTSResponse> {
    try {
      console.log(`🎯 gRPC TTS synthesis: "${text.substring(0, 50)}..."`);
      
      const request: GrpcTTSRequest = {
        text: text,
        voice: options.voice || 'en_US-amy-medium',
        language: options.language || 'en',
        speed: options.speed || 1.0,
        pitch: options.pitch || 0.0,
        outputFormat: options.outputFormat || 'wav',
        sampleRate: options.sampleRate || 22050,
      };

      const response = await fetch(`${this.baseUrl}/api/grpc-tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success && result.audioData) {
        // Convert base64 back to Uint8Array
        const audioBytes = new Uint8Array(
          atob(result.audioData)
            .split('')
            .map((char) => char.charCodeAt(0))
        );

        return {
          audioData: audioBytes,
          duration: result.duration || 0,
          sampleRate: result.sampleRate || 22050,
          format: result.format || 'wav',
          success: true,
        };
      } else {
        return {
          audioData: new Uint8Array(0),
          duration: 0,
          sampleRate: 22050,
          format: 'wav',
          success: false,
          errorMessage: result.errorMessage || 'Synthesis failed',
        };
      }

    } catch (error) {
      console.error('gRPC TTS synthesis error:', error);
      return {
        audioData: new Uint8Array(0),
        duration: 0,
        sampleRate: 22050,
        format: 'wav',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Stream speech synthesis for real-time audio generation
   */
  async streamingSynthesize(
    text: string,
    options: any = {},
    onChunk: (chunk: { audioData: Uint8Array; isFinal: boolean; timestamp: number }) => void,
    onComplete: () => void,
    onError: (error: any) => void
  ): Promise<void> {
    try {
      console.log(`🎯 gRPC TTS streaming synthesis: "${text.substring(0, 50)}..."`);

      const request: GrpcTTSRequest = {
        text: text,
        voice: options.voice || 'en_US-amy-medium',
        language: options.language || 'en',
        speed: options.speed || 1.0,
        pitch: options.pitch || 0.0,
        outputFormat: options.outputFormat || 'wav',
        sampleRate: options.sampleRate || 22050,
      };

      // Use Server-Sent Events for streaming
      const response = await fetch(`${this.baseUrl}/api/grpc-tts-streaming`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Handle Server-Sent Events
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Response body is null');
      }

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'end') {
                onComplete();
                return;
              } else if (data.type === 'error') {
                onError(data);
                return;
              } else {
                // Regular audio chunk
                if (data.audioData) {
                  console.log(`🎵 Processing base64 audio chunk, length: ${data.audioData.length}`);
                  
                  try {
                    // Robust base64 decoding for large audio chunks
                    const binaryString = atob(data.audioData);
                    const audioBytes = new Uint8Array(binaryString.length);
                    
                    for (let i = 0; i < binaryString.length; i++) {
                      audioBytes[i] = binaryString.charCodeAt(i);
                    }
                    
                    console.log(`🎵 Decoded audio bytes length: ${audioBytes.length}`);
                    console.log(`🎵 First few bytes: [${Array.from(audioBytes.slice(0, 10)).join(', ')}]`);

                    onChunk({
                      audioData: audioBytes,
                      isFinal: data.isFinal || false,
                      timestamp: data.timestamp || 0,
                    });
                  } catch (decodeError) {
                    console.error('Error decoding base64 audio data:', decodeError);
                  }
                }
              }
            } catch (parseError) {
              console.error('Error parsing SSE data:', parseError);
            }
          }
        }
      }

      onComplete();

    } catch (error) {
      console.error('Streaming gRPC TTS synthesis error:', error);
      onError({
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get available voices from gRPC TTS server
   */
  async getVoices(language?: string): Promise<GrpcVoicesResponse> {
    try {
      const url = new URL(`${this.baseUrl}/api/grpc-tts-voices`);
      if (language) {
        url.searchParams.set('language', language);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result as GrpcVoicesResponse;

    } catch (error) {
      console.error('gRPC TTS get voices error:', error);
      return {
        voices: [],
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create audio URL from audio data for playback
   */
  createAudioUrl(audioData: Uint8Array, format: string = 'wav'): string | null {
    console.log(`🎵 Creating audio URL for ${audioData.length} bytes`);
    
    // Ensure the audio data has proper WAV headers
    const wavData = ensureWavFormat(audioData, {
      sampleRate: 22050,
      channels: 1,
      bitsPerSample: 16
    });
    
    if (wavData.length === 0) {
      console.log(`🎵 No audio data after processing, skipping URL creation`);
      return null;
    }
    
    const buffer = new ArrayBuffer(wavData.length);
    const uint8View = new Uint8Array(buffer);
    uint8View.set(wavData);
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    console.log(`🎵 Created WAV audio URL: ${url.substring(0, 50)}...`);
    return url;
  }
}

// Export singleton instance
export const grpcTTSService = new GrpcTTSService();

// Export types
export type {
  GrpcTTSRequest,
  GrpcTTSResponse,
  GrpcVoice,
  GrpcVoicesResponse,
};