// API route to proxy gRPC calls for browser compatibility
import { NextRequest, NextResponse } from 'next/server';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

// Define types for gRPC messages
interface TranscribeRequest {
  audioData: string; // base64 encoded
  model?: string;
  language?: string;
  wordTimestamps?: boolean;
  temperature?: number;
  vadThreshold?: number;
}

// Load the protobuf definition
const PROTO_PATH = path.join(process.cwd(), 'proto', 'stt.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const sttProto = grpc.loadPackageDefinition(packageDefinition).stt as any;

// gRPC client implementation with singleton pattern
class GrpcSTTClient {
  private static instance: GrpcSTTClient;
  private client: any;
  private grpcServerHost: string;
  private grpcServerPort: number;

  private constructor() {
    this.grpcServerHost = process.env.GRPC_STT_HOST || 'localhost';
    this.grpcServerPort = parseInt(process.env.GRPC_STT_PORT || '50051');
    
    // Create gRPC client
    this.client = new sttProto.SpeechToText(
      `${this.grpcServerHost}:${this.grpcServerPort}`,
      grpc.credentials.createInsecure()
    );
    
    console.log(`🔌 gRPC client connected to ${this.grpcServerHost}:${this.grpcServerPort}`);
  }

  static getInstance(): GrpcSTTClient {
    if (!GrpcSTTClient.instance) {
      GrpcSTTClient.instance = new GrpcSTTClient();
    }
    return GrpcSTTClient.instance;
  }

  async transcribe(request: TranscribeRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      try {
        console.log(`🎯 Calling gRPC STT server at ${this.grpcServerHost}:${this.grpcServerPort}`);
        
        // Convert base64 to buffer
        const audioBytes = Buffer.from(request.audioData, 'base64');
        console.log(`📡 Audio data size: ${audioBytes.length} bytes`);
        
        // Check if audio data is too large (>10MB)
        if (audioBytes.length > 10 * 1024 * 1024) {
          console.warn(`⚠️ Large audio file: ${audioBytes.length} bytes`);
        }
        
        // Prepare gRPC request
        const grpcRequest = {
          audio_data: audioBytes,
          model: request.model || 'distil-medium.en',
          language: request.language || 'en',
          word_timestamps: request.wordTimestamps || false,
          temperature: request.temperature || 0.0,
          vad_threshold: request.vadThreshold || 0.0,
        };
        
        console.log(`🔧 gRPC request config:`, {
          model: grpcRequest.model,
          language: grpcRequest.language,
          audioSize: audioBytes.length,
          wordTimestamps: grpcRequest.word_timestamps
        });

        // Set timeout for gRPC call (30 seconds - reasonable for distil-medium.en)
        const timeout = setTimeout(() => {
          console.error('❌ gRPC call timeout after 30 seconds');
          resolve({
            text: '',
            language: request.language || 'en',
            duration: 0,
            segments: [],
            words: [],
            success: false,
            errorMessage: 'gRPC call timeout after 30 seconds',
          });
        }, 30000);

        // Call the gRPC server
        console.log(`🚀 Sending gRPC Transcribe request...`);
        this.client.Transcribe(grpcRequest, (error: any, response: any) => {
          clearTimeout(timeout);
          const endTime = Date.now();
          console.log(`⏱️ gRPC call took ${endTime - startTime}ms`);
          
          if (error) {
            console.error('❌ gRPC call failed:', error);
            resolve({
              text: '',
              language: request.language || 'en',
              duration: 0,
              segments: [],
              words: [],
              success: false,
              errorMessage: `gRPC call failed: ${error.message}`,
            });
          } else {
            console.log('✅ gRPC transcription successful');
            resolve({
              text: response.text || '',
              language: response.language || 'en',
              duration: response.duration || 0,
              segments: response.segments || [],
              words: response.words || [],
              success: response.success || true,
              errorMessage: response.error_message || '',
            });
          }
        });
      } catch (error) {
        console.error('❌ gRPC client error:', error);
        resolve({
          text: '',
          language: request.language || 'en',
          duration: 0,
          segments: [],
          words: [],
          success: false,
          errorMessage: `gRPC client error: ${error}`,
        });
      }
    });
  }

  // New streaming transcription method
  streamingTranscribe(request: TranscribeRequest, onChunk: (chunk: any) => void, onEnd: () => void, onError: (error: any) => void): void {
    try {
      console.log(`🎯 Starting streaming gRPC STT at ${this.grpcServerHost}:${this.grpcServerPort}`);
      
      // Convert base64 to buffer
      const audioBytes = Buffer.from(request.audioData, 'base64');
      console.log(`📡 Streaming audio data size: ${audioBytes.length} bytes`);
      
      // Prepare gRPC request
      const grpcRequest = {
        audio_data: audioBytes,
        model: request.model || 'distil-medium.en',
        language: request.language || 'en',
        word_timestamps: request.wordTimestamps || false,
        temperature: request.temperature || 0.0,
        vad_threshold: request.vadThreshold || 0.0,
      };
      
      console.log(`🔧 Streaming gRPC request config:`, {
        model: grpcRequest.model,
        language: grpcRequest.language,
        audioSize: audioBytes.length,
        wordTimestamps: grpcRequest.word_timestamps
      });

      // Call the streaming gRPC method
      console.log(`🚀 Starting gRPC StreamingTranscribe...`);
      const call = this.client.StreamingTranscribe(grpcRequest);
      
      call.on('data', (response: any) => {
        console.log(`📦 Streaming chunk received:`, response.text);
        onChunk({
          text: response.text || '',
          language: response.language || 'en',
          duration: response.duration || 0,
          segments: response.segments || [],
          words: response.words || [],
          success: response.success || true,
          isPartial: response.is_partial || false,
          errorMessage: response.error_message || '',
        });
      });
      
      call.on('end', () => {
        console.log('✅ Streaming transcription completed');
        onEnd();
      });
      
      call.on('error', (error: any) => {
        console.error('❌ Streaming gRPC call failed:', error);
        onError({
          text: '',
          language: request.language || 'en',
          duration: 0,
          segments: [],
          words: [],
          success: false,
          errorMessage: `Streaming gRPC call failed: ${error.message}`,
        });
      });
      
    } catch (error) {
      console.error('❌ Streaming gRPC client error:', error);
      onError({
        text: '',
        language: request.language || 'en',
        duration: 0,
        segments: [],
        words: [],
        success: false,
        errorMessage: `Streaming gRPC client error: ${error}`,
      });
    }
  }



  async getCapabilities(): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        console.log('🎯 Getting gRPC STT capabilities');
        
        const request = {}; // Empty capabilities request
        
        this.client.GetCapabilities(request, (error: any, response: any) => {
          if (error) {
            console.error('❌ gRPC capabilities call failed:', error);
            // Return default capabilities on error
            resolve(this.getDefaultCapabilities());
          } else {
            console.log('✅ gRPC capabilities retrieved');
            resolve({
              supportedModels: response.supported_models || [],
              supportedLanguages: response.supported_languages || [],
              supportedFormats: response.supported_formats || [],
              supportedResponseFormats: response.supported_response_formats || [],
              supportedTimestampGranularities: response.supported_timestamp_granularities || [],
            });
          }
        });
      } catch (error) {
        console.error('❌ gRPC capabilities error:', error);
        resolve(this.getDefaultCapabilities());
      }
    });
  }

  private getDefaultCapabilities() {
    // Default capabilities
    return {
      supportedModels: [
        'tiny.en', 'tiny', 'base.en', 'base', 'small.en', 'small',
        'medium.en', 'medium', 'large-v1', 'large-v2', 'large-v3',
        'large', 'distil-large-v2', 'distil-medium.en', 'distil-small.en',
        'distil-large-v3'
      ],
      supportedLanguages: [
        'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh',
        'ar', 'hi', 'tr', 'pl', 'nl', 'sv', 'da', 'no', 'fi'
      ],
      supportedFormats: ['wav', 'mp3', 'mp4', 'flac', 'ogg', 'webm'],
      supportedResponseFormats: ['text', 'verbose_json'],
      supportedTimestampGranularities: ['segment', 'word'],
    };
  }
}

const grpcClient = GrpcSTTClient.getInstance();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await grpcClient.transcribe(body);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { 
        success: false, 
        errorMessage: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const capabilities = await grpcClient.getCapabilities();
    return NextResponse.json(capabilities);
  } catch (error) {
    console.error('Capabilities API error:', error);
    return NextResponse.json(
      { error: 'Failed to get capabilities' },
      { status: 500 }
    );
  }
}