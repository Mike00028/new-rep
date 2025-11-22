import { NextRequest, NextResponse } from 'next/server';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

// Load the protobuf definition
const PROTO_PATH = path.join(process.cwd(), '..', 'grpc-tts-server', 'protos', 'tts.proto');

console.log('🔧 TTS Proto path:', PROTO_PATH);

let packageDefinition: any;
let ttsProto: any;

try {
  packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  console.log('✅ TTS Proto definition loaded');
  
  ttsProto = grpc.loadPackageDefinition(packageDefinition).tts as any;
  console.log('✅ TTS Proto package loaded');
  console.log('🔧 Available services:', Object.keys(ttsProto || {}));
} catch (error) {
  console.error('❌ Error loading TTS proto:', error);
  throw error;
}

// Singleton client
let client: any = null;

function getClient() {
  if (!client) {
    try {
      console.log('🔧 Creating new gRPC TTS client...');
      console.log('🔧 TTS Proto loaded:', !!ttsProto);
      console.log('🔧 TTS Service available:', !!ttsProto.TextToSpeech);
      
      client = new ttsProto.TextToSpeech('localhost:50052', grpc.credentials.createInsecure(), {
        'grpc.keepalive_time_ms': 10000,
        'grpc.keepalive_timeout_ms': 5000,
        'grpc.keepalive_permit_without_calls': true,
        'grpc.http2.max_pings_without_data': 0,
        'grpc.http2.min_time_between_pings_ms': 10000,
      });
      console.log('✅ gRPC TTS client created successfully');
    } catch (error) {
      console.error('❌ Error creating gRPC TTS client:', error);
      throw error;
    }
  }
  return client;
}

export async function POST(request: NextRequest) {
  try {
    console.log('🎯 TTS Streaming API called');
    const body = await request.json();
    console.log('📝 TTS Request body:', body);
    
    const { text, voice = 'en_US-lessac-medium', speed = 1.0, format = 'wav' } = body;

    if (!text) {
      console.error('❌ No text provided');
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    console.log('🔧 Getting gRPC client...');
    const client = getClient();
    console.log('✅ gRPC client obtained');
    console.log('🔌 Initiating gRPC StreamingSynthesize call...');

    // Create a readable stream for Server-Sent Events
    const stream = new ReadableStream({
      start(controller) {
        let isControllerClosed = false;
        
        const closeController = () => {
          if (!isControllerClosed) {
            try {
              controller.close();
              isControllerClosed = true;
              console.log('✅ TTS Stream controller closed successfully');
            } catch (error) {
              console.warn('⚠️ Controller already closed:', error);
            }
          }
        };
        
        try {
          const deadline = new Date();
          deadline.setSeconds(deadline.getSeconds() + 30);

          const call = client.StreamingSynthesize(
            {
              text,
              voice: voice || 'en_US-lessac-medium',
              speed: speed || 1.0,
              output_format: format || 'wav',
            },
            { deadline }
          );

          call.on('data', (chunk: any) => {
            if (isControllerClosed) return;
            
            console.log('📦 gRPC TTS chunk received:', chunk);
            try {
              const data = {
                type: 'chunk',
                audioData: Buffer.from(chunk.audio_data).toString('base64'),
                isFinal: chunk.is_final,
                timestamp: chunk.timestamp,
                format: 'wav',
              };
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
              );
              
              if (chunk.is_final) {
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify({ type: 'complete' })}\n\n`)
                );
                closeController();
              }
            } catch (error) {
              console.error('❌ Error processing TTS chunk:', error);
              closeController();
            }
          });

          call.on('error', (error: any) => {
            if (isControllerClosed) return;
            
            console.error('❌ gRPC TTS Streaming Error:', error);
            if (error && error.stack) {
              console.error('❌ gRPC TTS Error stack:', error.stack);
            }
            try {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ type: 'error', error: error?.message || 'TTS synthesis failed', details: error })}\n\n`
                )
              );
            } catch (enqueueError) {
              console.error('❌ Error enqueueing error message:', enqueueError);
            }
            closeController();
          });

          call.on('end', () => {
            console.log('🏁 gRPC TTS call ended');
            closeController();
          });
        } catch (err) {
          console.error('❌ Exception in TTS Streaming start:', err);
          try {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ type: 'error', error: 'Exception in TTS Streaming start', details: err })}\n\n`
              )
            );
          } catch (enqueueError) {
            console.error('❌ Error enqueueing exception message:', enqueueError);
          }
          closeController();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  } catch (error) {
    console.error('TTS Streaming API Error details:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}