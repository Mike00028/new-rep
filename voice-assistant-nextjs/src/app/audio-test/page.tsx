import { testBase64AudioPlayback } from '@/lib/audioTest';
import { ensureWavFormat } from '@/lib/wavUtils';

// Test with the base64 data you provided
const testBase64Data = "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";

export default function AudioTestPage() {
  const handleTestAudio = async () => {
    console.log('🧪 Starting audio test...');
    
    // Test 1: Raw base64 decoding and playback
    const success = await testBase64AudioPlayback(testBase64Data);
    
    if (!success) {
      console.log('🧪 Raw audio failed, testing WAV conversion...');
      
      // Test 2: Convert to WAV and test
      try {
        const binaryString = atob(testBase64Data);
        const rawData = new Uint8Array(binaryString.length);
        
        for (let i = 0; i < binaryString.length; i++) {
          rawData[i] = binaryString.charCodeAt(i);
        }
        
        const wavData = ensureWavFormat(rawData, {
          sampleRate: 22050,
          channels: 1,
          bitsPerSample: 16
        });
        
        const wavBase64 = btoa(String.fromCharCode(...wavData));
        const wavSuccess = await testBase64AudioPlayback(wavBase64);
        
        console.log(`🧪 WAV conversion test result: ${wavSuccess ? 'SUCCESS' : 'FAILED'}`);
        
      } catch (error) {
        console.error('🧪 WAV conversion test error:', error);
      }
    }
  };
  
  return (
    <div style={{ padding: '20px' }}>
      <h1>Audio Debug Test</h1>
      <button onClick={handleTestAudio}>Test Audio Playback</button>
      <p>Check the browser console for detailed debug output.</p>
    </div>
  );
}