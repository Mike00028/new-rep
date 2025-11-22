// gRPC client service for STT
// Note: This is a placeholder for browser-side gRPC communication
// In a real implementation, you'd use grpc-web or make HTTP calls to a gRPC-Web proxy

interface GrpcTranscribeRequest {
  audioData: Uint8Array;
  model?: string;
  language?: string;
  wordTimestamps?: boolean;
  temperature?: number;
  vadThreshold?: number;
}

interface GrpcSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  tokens?: number[];
  temperature?: number;
  avgLogprob?: number;
  compressionRatio?: number;
  noSpeechProb?: number;
}

interface GrpcWord {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

interface GrpcTranscribeResponse {
  text: string;
  language: string;
  duration: number;
  segments: GrpcSegment[];
  words: GrpcWord[];
  success: boolean;
  errorMessage?: string;
}

interface GrpcCapabilitiesResponse {
  supportedModels: string[];
  supportedLanguages: string[];
  supportedFormats: string[];
  supportedResponseFormats: string[];
  supportedTimestampGranularities: string[];
}

class GrpcSTTService {
  private baseUrl: string;

  constructor(baseUrl: string = '') { // Use relative URLs for Next.js API routes
    this.baseUrl = baseUrl;
  }

  /**
   * Convert audio blob to transcription using gRPC STT server
   * For now, this makes HTTP calls to a gRPC-Web proxy or REST endpoint
   */
  async transcribe(
    audioBlob: Blob, 
    options: {
      model?: string;
      language?: string;
      wordTimestamps?: boolean;
      temperature?: number;
    } = {}
  ): Promise<GrpcTranscribeResponse> {
    try {
      // Convert blob to bytes
      const audioArrayBuffer = await audioBlob.arrayBuffer();
      const audioBytes = new Uint8Array(audioArrayBuffer);

      // For browser compatibility, we'll make a REST call to a gRPC-Web gateway
      // In production, you'd set up envoy or a similar proxy to convert gRPC-Web to gRPC
      const request: GrpcTranscribeRequest = {
        audioData: audioBytes,
        model: options.model || 'distil-medium.en',
        language: options.language || 'en',
        wordTimestamps: options.wordTimestamps || false,
        temperature: options.temperature || 0.0,
      };

      // Convert Uint8Array to base64 for JSON transport (handle large arrays properly)
      const audioDataBase64 = btoa(
        Array.from(audioBytes, byte => String.fromCharCode(byte)).join('')
      );

      const response = await fetch(`${this.baseUrl}/api/grpc-stt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioData: audioDataBase64,
          model: request.model,
          language: request.language,
          wordTimestamps: request.wordTimestamps,
          temperature: request.temperature,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result as GrpcTranscribeResponse;

    } catch (error) {
      console.error('gRPC STT transcription error:', error);
      return {
        text: '',
        language: 'en',
        duration: 0,
        segments: [],
        words: [],
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get server capabilities
   */
  async getCapabilities(): Promise<GrpcCapabilitiesResponse | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/grpc-stt`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result as GrpcCapabilitiesResponse;

    } catch (error) {
      console.error('gRPC STT capabilities error:', error);
      return null;
    }
  }

  /**
   * Direct gRPC call for transcription (requires gRPC-Web setup)
   * This is a placeholder for when you have a proper gRPC-Web proxy
   */
  async transcribeGrpcWeb(audioBlob: Blob, options: any = {}): Promise<GrpcTranscribeResponse> {
    // This would use @grpc/grpc-js or grpc-web client
    // For now, fallback to REST API
    return this.transcribe(audioBlob, options);
  }

  /**
   * Streaming transcription using Server-Sent Events
   */
  async streamingTranscribe(
    audioBlob: Blob,
    options: any = {},
    onChunk: (chunk: any) => void,
    onComplete: () => void,
    onError: (error: any) => void
  ): Promise<void> {
    try {
      // Convert blob to bytes
      const audioArrayBuffer = await audioBlob.arrayBuffer();
      const audioBytes = new Uint8Array(audioArrayBuffer);

      // Convert Uint8Array to base64 for JSON transport (handle large arrays properly)
      const audioDataBase64 = btoa(
        Array.from(audioBytes, byte => String.fromCharCode(byte)).join('')
      );

      // Make request to streaming endpoint
      const response = await fetch(`${this.baseUrl}/api/grpc-stt-streaming`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioData: audioDataBase64,
          model: options.model || 'distil-medium.en',
          language: options.language || 'en',
          wordTimestamps: options.wordTimestamps || false,
          temperature: options.temperature || 0.0,
        }),
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
                // Regular transcription chunk
                onChunk({
                  text: data.text || '',
                  isPartial: data.isPartial || false,
                  segments: data.segments || [],
                  words: data.words || [],
                  confidence: 1.0,
                  language: data.language || 'en',
                  duration: data.duration || 0,
                  success: data.success || true,
                  errorMessage: data.errorMessage || '',
                });
              }
            } catch (parseError) {
              console.error('Error parsing SSE data:', parseError);
            }
          }
        }
      }

      onComplete();

    } catch (error) {
      console.error('Streaming gRPC STT transcription error:', error);
      onError({
        text: '',
        language: 'en',
        duration: 0,
        segments: [],
        words: [],
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Legacy streaming method for backward compatibility
   */
  async* streamingTranscribeLegacy(audioChunks: AsyncIterable<Uint8Array>, options: any = {}) {
    // This would implement streaming gRPC calls
    // For now, batch process chunks
    const chunks: Uint8Array[] = [];
    
    for await (const chunk of audioChunks) {
      chunks.push(chunk);
    }

    // Combine chunks and transcribe
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combinedAudio = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const chunk of chunks) {
      combinedAudio.set(chunk, offset);
      offset += chunk.length;
    }

    const audioBlob = new Blob([combinedAudio], { type: 'audio/wav' });
    const result = await this.transcribe(audioBlob, options);
    
    yield {
      text: result.text,
      isFinal: true,
      segments: result.segments,
      words: result.words,
      confidence: 1.0,
      errorMessage: result.errorMessage || '',
    };
  }
}

// Export singleton instance
export const grpcSTTService = new GrpcSTTService();

// Export types
export type {
  GrpcTranscribeRequest,
  GrpcTranscribeResponse,
  GrpcCapabilitiesResponse,
  GrpcSegment,
  GrpcWord,
};