// Streaming gRPC STT API route with Server-Sent Events
import { NextRequest } from 'next/server';
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

// gRPC client for streaming (reuse singleton pattern)
class StreamingGrpcSTTClient {
  private static instance: StreamingGrpcSTTClient;
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
    
    console.log(`🔌 Streaming gRPC client connected to ${this.grpcServerHost}:${this.grpcServerPort}`);
  }

  static getInstance(): StreamingGrpcSTTClient {
    if (!StreamingGrpcSTTClient.instance) {
      StreamingGrpcSTTClient.instance = new StreamingGrpcSTTClient();
    }
    return StreamingGrpcSTTClient.instance;
  }

  streamingTranscribe(request: TranscribeRequest, onChunk: (chunk: any) => void, onEnd: () => void, onError: (error: any) => void): void {
    try {
      console.log(`🎯 Starting streaming gRPC STT at ${this.grpcServerHost}:${this.grpcServerPort}`);
      
      // Convert base64 to buffer
      const audioBytes = Buffer.from(request.audioData, 'base64');
      console.log(`📡 Streaming audio data size: ${audioBytes.length} bytes`);
      
      console.log(`🔧 Streaming gRPC request config:`, {
        model: request.model || 'distil-medium.en',
        language: request.language || 'en',
        audioSize: audioBytes.length,
        wordTimestamps: request.wordTimestamps || false
      });

      // Call the streaming gRPC method
      console.log(`🚀 Starting gRPC StreamingTranscribe...`);
      const call = this.client.StreamingTranscribe();
      
      // Send configuration first
      call.write({
        config: {
          model: request.model || 'distil-medium.en',
          language: request.language || 'en',
          interim_results: true,
          vad_threshold: request.vadThreshold || 0.0,
          word_timestamps: request.wordTimestamps || false,
        }
      });
      
      // Send audio data in chunks (simulate streaming even though we have full audio)
      const chunkSize = 4096; // 4KB chunks
      for (let i = 0; i < audioBytes.length; i += chunkSize) {
        const chunk = audioBytes.slice(i, i + chunkSize);
        call.write({
          audio_chunk: chunk
        });
      }
      
      // End the stream
      call.end();
      
      call.on('data', (response: any) => {
        console.log(`📦 Streaming chunk received:`, response);
        onChunk({
          text: response.text || '',
          language: request.language || 'en',
          duration: 0,
          segments: response.segments || [],
          words: response.words || [],
          success: true,
          isPartial: !response.is_final,
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
}

const streamingGrpcClient = StreamingGrpcSTTClient.getInstance();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Create Server-Sent Events response
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        
        // Handle streaming chunks
        const onChunk = (chunk: any) => {
          const data = `data: ${JSON.stringify(chunk)}\n\n`;
          controller.enqueue(encoder.encode(data));
        };
        
        // Handle stream end
        const onEnd = () => {
          const data = `data: ${JSON.stringify({ type: 'end' })}\n\n`;
          controller.enqueue(encoder.encode(data));
          controller.close();
        };
        
        // Handle errors
        const onError = (error: any) => {
          const data = `data: ${JSON.stringify({ type: 'error', ...error })}\n\n`;
          controller.enqueue(encoder.encode(data));
          controller.close();
        };
        
        // Start streaming transcription
        streamingGrpcClient.streamingTranscribe(body, onChunk, onEnd, onError);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
    
  } catch (error) {
    console.error('Streaming API error:', error);
    return new Response(
      JSON.stringify({ 
        type: 'error',
        success: false, 
        errorMessage: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}