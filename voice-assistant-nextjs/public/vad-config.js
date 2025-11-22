// VAD configuration for proper WASM loading
window.vadConfig = {
  modelURL: '/vad/silero_vad_v5.onnx',
  wasmURL: '/vad/ort-wasm-simd-threaded.wasm',
  wasmjsURL: '/vad/ort-wasm-simd-threaded.mjs',
  ortURL: '/vad/ort.wasm.min.js'
};

// Ensure WASM files are properly loaded with correct MIME type
if (typeof window !== 'undefined') {
  // Pre-load WASM file to ensure it's available
  const preloadWasm = async () => {
    try {
      const wasmResponse = await fetch('/vad/ort-wasm-simd-threaded.wasm');
      if (!wasmResponse.ok) {
        throw new Error(`Failed to preload WASM: ${wasmResponse.status}`);
      }
      console.log('✅ WASM file preloaded successfully');
    } catch (error) {
      console.error('❌ Failed to preload WASM:', error);
    }
  };
  
  // Preload when document is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', preloadWasm);
  } else {
    preloadWasm();
  }
}