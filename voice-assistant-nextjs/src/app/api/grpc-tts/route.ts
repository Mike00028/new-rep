import { NextRequest, NextResponse } from 'next/server';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

// Load the protobuf definition
const PROTO_PATH = path.join(process.cwd(), '..', 'grpc-tts-server', 'protos', 'tts.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const ttsProto = grpc.loadPackageDefinition(packageDefinition).tts as any;

// Singleton client
let client: any = null;

function getClient() {
  if (!client) {
    client = new ttsProto.TTSService('localhost:50052', grpc.credentials.createInsecure(), {
      'grpc.keepalive_time_ms': 10000,
      'grpc.keepalive_timeout_ms': 5000,
      'grpc.keepalive_permit_without_calls': true,
      'grpc.http2.max_pings_without_data': 0,
      'grpc.http2.min_time_between_pings_ms': 10000,
    });
  }
  return client;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, voice = 'en_US-lessac-medium', speed = 1.0, format = 'wav' } = body;

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const client = getClient();

    return new Promise((resolve) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 30);

      client.Synthesize(
        {
          text,
          voice_id: voice,
          speed,
          format,
        },
        { deadline },
        (error: any, response: any) => {
          if (error) {
            console.error('gRPC TTS Error:', error);
            resolve(NextResponse.json({ error: 'TTS synthesis failed' }, { status: 500 }));
            return;
          }

          // Return audio data as base64
          const audioBase64 = Buffer.from(response.audio_data).toString('base64');
          resolve(NextResponse.json({
            audioData: audioBase64,
            format: response.format,
            duration: response.duration,
          }));
        }
      );
    });
  } catch (error) {
    console.error('TTS API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}