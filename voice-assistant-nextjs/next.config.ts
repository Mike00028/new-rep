import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  env: {
    'NEXT_PUBLIC_FAST_WHISPER_URL': process.env.NEXT_PUBLIC_FAST_WHISPER_URL,
    'NEXT_PUBLIC_LLM_SERVER_URL': process.env.NEXT_PUBLIC_LLM_SERVER_URL,
    'NEXT_PUBLIC_PIPER_TTS_URL': process.env.NEXT_PUBLIC_PIPER_TTS_URL,
    'NEXT_PUBLIC_MODEL_NAME': process.env.NEXT_PUBLIC_MODEL_NAME,
    'NEXT_PUBLIC_SESSION_CREATE_URL': process.env.NEXT_PUBLIC_SESSION_CREATE_URL,
    'NEXT_PUBLIC_SESSION_DELETE_URL': process.env.NEXT_PUBLIC_SESSION_DELETE_URL,
    'NEXT_PUBLIC_BASE_URL': process.env.NEXT_PUBLIC_BASE_URL,
  },
  // Add headers for WASM files
  async headers() {
    return [
      {
        source: '/:path*.wasm',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/wasm',
          },
        ],
      },
      {
        source: '/:path*.onnx',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/octet-stream',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
