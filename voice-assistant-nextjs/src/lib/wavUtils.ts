/**
 * WAV File Utilities
 * Convert raw audio data to proper WAV format with headers
 */

export interface WavConfig {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/**
 * Create a complete WAV file from raw PCM audio data
 */
export function createWavFromPCM(
  pcmData: Uint8Array, 
  config: WavConfig = { sampleRate: 22050, channels: 1, bitsPerSample: 16 }
): Uint8Array {
  const { sampleRate, channels, bitsPerSample } = config;
  
  // Calculate sizes
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length;
  const fileSize = 44 + dataSize; // 44 bytes for WAV header + data
  
  // Create WAV file buffer
  const wavBuffer = new ArrayBuffer(fileSize);
  const view = new DataView(wavBuffer);
  const uint8View = new Uint8Array(wavBuffer);
  
  let offset = 0;
  
  // RIFF header
  view.setUint32(offset, 0x52494646, false); // "RIFF"
  offset += 4;
  view.setUint32(offset, fileSize - 8, true); // File size - 8
  offset += 4;
  view.setUint32(offset, 0x57415645, false); // "WAVE"
  offset += 4;
  
  // Format chunk
  view.setUint32(offset, 0x666d7420, false); // "fmt "
  offset += 4;
  view.setUint32(offset, 16, true); // Format chunk size
  offset += 4;
  view.setUint16(offset, 1, true); // Audio format (1 = PCM)
  offset += 2;
  view.setUint16(offset, channels, true); // Number of channels
  offset += 2;
  view.setUint32(offset, sampleRate, true); // Sample rate
  offset += 4;
  view.setUint32(offset, byteRate, true); // Byte rate
  offset += 4;
  view.setUint16(offset, blockAlign, true); // Block align
  offset += 2;
  view.setUint16(offset, bitsPerSample, true); // Bits per sample
  offset += 2;
  
  // Data chunk
  view.setUint32(offset, 0x64617461, false); // "data"
  offset += 4;
  view.setUint32(offset, dataSize, true); // Data size
  offset += 4;
  
  // Copy PCM data
  uint8View.set(pcmData, offset);
  
  return new Uint8Array(wavBuffer);
}

/**
 * Check if data already has WAV header
 */
export function hasWavHeader(data: Uint8Array): boolean {
  if (data.length < 12) return false;
  
  const riff = String.fromCharCode(data[0], data[1], data[2], data[3]);
  const wave = String.fromCharCode(data[8], data[9], data[10], data[11]);
  
  return riff === 'RIFF' && wave === 'WAVE';
}

/**
 * Extract PCM data from WAV chunk (handles partial WAV headers)
 */
export function extractPCMFromChunk(data: Uint8Array): Uint8Array {
  // If this chunk starts with WAV header, skip it
  if (hasWavHeader(data)) {
    console.log(`🎵 Chunk contains WAV header, extracting PCM data`);
    // WAV header is typically 44 bytes
    if (data.length > 44) {
      return data.slice(44);
    } else {
      // This chunk is only header, no PCM data
      return new Uint8Array(0);
    }
  }
  
  // Otherwise, assume this is raw PCM data
  return data;
}

/**
 * Convert raw audio data to WAV format if needed
 * For streaming chunks, extracts PCM data and creates complete WAV
 */
export function ensureWavFormat(
  audioData: Uint8Array,
  config: WavConfig = { sampleRate: 22050, channels: 1, bitsPerSample: 16 }
): Uint8Array {
  console.log(`🎵 Processing audio chunk, data length: ${audioData.length}`);
  
  // Extract PCM data (removes WAV header if present)
  const pcmData = extractPCMFromChunk(audioData);
  
  if (pcmData.length === 0) {
    console.log(`🎵 No PCM data in chunk (header-only), skipping`);
    return new Uint8Array(0);
  }
  
  console.log(`🎵 Creating WAV file from ${pcmData.length} bytes of PCM data`);
  return createWavFromPCM(pcmData, config);
}

/**
 * Create audio URL from raw or WAV audio data
 */
export function createAudioUrl(audioData: Uint8Array, ensureWav: boolean = true): string | null {
  const wavData = ensureWav ? ensureWavFormat(audioData) : audioData;
  
  if (wavData.length === 0) {
    console.log(`🎵 No audio data to create URL for`);
    return null;
  }
  
  const buffer = new ArrayBuffer(wavData.length);
  const uint8View = new Uint8Array(buffer);
  uint8View.set(wavData);
  const blob = new Blob([buffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  
  console.log(`🎵 Created audio URL for ${wavData.length} bytes: ${url.substring(0, 50)}...`);
  return url;
}