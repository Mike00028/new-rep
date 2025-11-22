// Audio Test Utility to debug TTS audio playback issues

export function testBase64AudioPlayback(base64AudioData: string): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`🧪 Testing base64 audio playback, data length: ${base64AudioData.length}`);
    
    try {
      // Method 1: Direct base64 to blob conversion
      const binaryString = atob(base64AudioData);
      const audioBytes = new Uint8Array(binaryString.length);
      
      for (let i = 0; i < binaryString.length; i++) {
        audioBytes[i] = binaryString.charCodeAt(i);
      }
      
      console.log(`🧪 Decoded ${audioBytes.length} bytes`);
      console.log(`🧪 First 16 bytes: [${Array.from(audioBytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(', ')}]`);
      
      // Check if this looks like a WAV file
      const wavHeader = String.fromCharCode(...audioBytes.slice(0, 4));
      const isWAV = wavHeader === 'RIFF';
      console.log(`🧪 WAV header check: "${wavHeader}" (is WAV: ${isWAV})`);
      
      if (isWAV) {
        const wavFormat = String.fromCharCode(...audioBytes.slice(8, 12));
        console.log(`🧪 WAV format: "${wavFormat}"`);
      }
      
      // Create blob and test playback
      const blob = new Blob([audioBytes], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(blob);
      
      console.log(`🧪 Created blob: ${blob.size} bytes, type: ${blob.type}`);
      console.log(`🧪 Audio URL: ${audioUrl}`);
      
      // Test with Audio element
      const testAudio = new Audio();
      
      testAudio.onloadeddata = () => {
        console.log(`🧪 ✅ Audio loaded successfully`);
        console.log(`🧪 Duration: ${testAudio.duration}s`);
        console.log(`🧪 Ready state: ${testAudio.readyState}`);
        resolve(true);
      };
      
      testAudio.oncanplaythrough = () => {
        console.log(`🧪 ✅ Audio can play through`);
      };
      
      testAudio.onerror = (error) => {
        console.error(`🧪 ❌ Audio error:`, error);
        console.error(`🧪 ❌ Error code: ${testAudio.error?.code}`);
        console.error(`🧪 ❌ Error message: ${testAudio.error?.message}`);
        resolve(false);
      };
      
      testAudio.onloadstart = () => {
        console.log(`🧪 🔄 Audio load started`);
      };
      
      testAudio.src = audioUrl;
      
      // Timeout after 5 seconds
      setTimeout(() => {
        console.log(`🧪 ⏰ Test timeout - audio may not be valid`);
        resolve(false);
      }, 5000);
      
    } catch (error) {
      console.error(`🧪 ❌ Error in audio test:`, error);
      resolve(false);
    }
  });
}

export function testAudioPlayback(audioUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`🧪 Testing audio URL playback: ${audioUrl.substring(0, 50)}...`);
    
    const testAudio = new Audio();
    
    testAudio.oncanplaythrough = () => {
      console.log(`🧪 ✅ Audio can play through`);
      testAudio.play().then(() => {
        console.log(`🧪 ✅ Audio started playing`);
        resolve(true);
      }).catch((error) => {
        console.error(`🧪 ❌ Play failed:`, error);
        resolve(false);
      });
    };
    
    testAudio.onerror = (error) => {
      console.error(`🧪 ❌ Audio playback error:`, error);
      resolve(false);
    };
    
    testAudio.src = audioUrl;
    
    setTimeout(() => {
      console.log(`🧪 ⏰ Playback test timeout`);
      resolve(false);
    }, 3000);
  });
}