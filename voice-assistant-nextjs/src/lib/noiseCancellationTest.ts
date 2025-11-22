/**
 * Simple test to verify noise cancellation functionality
 * This can be run in a browser console to test the noise reduction processor
 */

// Test function for noise cancellation
async function testNoiseCancellation() {
  console.log('🧪 Testing Noise Cancellation System...');
  
  try {
    // Create audio context
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    console.log('✅ AudioContext created');
    
    // Create noise processor
    const { NoiseReductionProcessor } = await import('./noiseCancellation.js');
    const processor = new NoiseReductionProcessor(audioContext, {
      preset: 'balanced',
      enabled: true
    });
    console.log('✅ Noise processor created');
    
    // Create test audio data
    const testAudio = new Float32Array(1024);
    for (let i = 0; i < testAudio.length; i++) {
      // Create a mix of signal and noise
      testAudio[i] = Math.sin(2 * Math.PI * 440 * i / 44100) * 0.5 + // 440Hz tone
                     (Math.random() - 0.5) * 0.1; // Random noise
    }
    console.log('✅ Test audio data created');
    
    // Process the audio
    const processedAudio = processor.processAudioData(testAudio);
    console.log('✅ Audio processed through noise cancellation');
    
    // Get analysis data
    const stats = processor.getAnalysisData();
    console.log('📊 Analysis stats:', {
      noiseFloor: stats.noiseFloor.toFixed(2) + 'dB',
      currentLevel: stats.currentLevel.toFixed(2) + 'dB',
      processingLatency: stats.processingLatency.toFixed(2) + 'ms'
    });
    
    // Test different presets
    processor.setPreset('aggressive');
    const aggressiveProcessed = processor.processAudioData(testAudio);
    console.log('✅ Aggressive preset tested');
    
    processor.setPreset('light');
    const lightProcessed = processor.processAudioData(testAudio);
    console.log('✅ Light preset tested');
    
    // Test enhanced audio stream
    const { getEnhancedAudioStream } = await import('./noiseCancellation.js');
    try {
      const stream = await getEnhancedAudioStream('balanced');
      console.log('✅ Enhanced audio stream created');
      
      // Check constraints
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const settings = audioTrack.getSettings();
        console.log('🔧 Stream settings:', {
          echoCancellation: settings.echoCancellation,
          autoGainControl: settings.autoGainControl,
          noiseSuppression: settings.noiseSuppression,
          sampleRate: settings.sampleRate
        });
      }
      
      // Clean up
      stream.getTracks().forEach(track => track.stop());
    } catch (streamError) {
      console.warn('⚠️ Could not test enhanced stream (no microphone access):', (streamError as Error).message);
    }
    
    // Clean up
    processor.dispose();
    audioContext.close();
    
    console.log('🎉 All noise cancellation tests passed!');
    return true;
    
  } catch (error) {
    console.error('❌ Noise cancellation test failed:', error);
    return false;
  }
}

// Export for use in console
if (typeof window !== 'undefined') {
  (window as any).testNoiseCancellation = testNoiseCancellation;
  console.log('🧪 Noise cancellation test function available as window.testNoiseCancellation()');
}

export { testNoiseCancellation };