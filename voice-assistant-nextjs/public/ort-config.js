// Configure ONNX Runtime Web to use local files for offline operation
if (typeof window !== 'undefined' && window.ort) {
  // Point to local directory for WASM files if needed
  window.ort.env.wasm.wasmPaths = '/';
}
