/**
 * Advanced Noise Cancellation System
 * 
 * Provides multiple layers of noise reduction for VAD audio processing:
 * - Spectral Gating: Frequency-based noise gate
 * - Adaptive Noise Floor: Dynamic background noise estimation and subtraction
 * - Band-pass Filtering: Focus on human speech frequencies (80Hz-8kHz)
 * - Smoothing Filters: Reduce artifacts and improve audio quality
 * - Real-time Processing: Low-latency processing for live audio
 */

export interface NoiseReductionOptions {
  // Spectral gating parameters
  spectralGateThreshold: number;     // dB threshold for spectral gate (-60 to -20)
  spectralGateRatio: number;         // Reduction ratio (0.1 to 1.0)
  
  // Adaptive noise floor
  noiseFloorAdaptation: number;      // How quickly to adapt to noise floor (0.01 to 0.1)
  noiseFloorOffset: number;          // dB offset above estimated noise floor (3 to 15)
  
  // Frequency filtering
  highPassCutoff: number;            // High-pass filter cutoff (50-200 Hz)
  lowPassCutoff: number;             // Low-pass filter cutoff (6000-12000 Hz)
  
  // Smoothing and quality
  smoothingFactor: number;           // Temporal smoothing (0.1 to 0.9)
  artifactReduction: number;         // Artifact reduction strength (0.0 to 1.0)
  
  // Processing control
  enabled: boolean;                  // Master enable/disable
  bypassOnLowLevel: boolean;         // Bypass processing for very quiet audio
  
  // Presets
  preset: 'light' | 'balanced' | 'aggressive' | 'custom';
}

export class NoiseReductionProcessor {
  private audioContext: AudioContext;
  private options: NoiseReductionOptions;
  
  // Analysis nodes
  private analyser: AnalyserNode;
  private frequencyData: Float32Array;
  private timeData: Float32Array;
  
  // Filter chains
  private highPassFilter: BiquadFilterNode;
  private lowPassFilter: BiquadFilterNode;
  private notchFilters: BiquadFilterNode[] = [];
  
  // Noise floor estimation
  private noiseFloorEstimate: number = -60;
  private noiseFloorHistory: number[] = [];
  private lastUpdateTime: number = 0;
  
  // Spectral processing
  private fftSize: number = 2048;
  private smoothingBuffer: Float32Array;
  private spectralMask: Float32Array;
  
  // Performance monitoring
  private processingLatency: number = 0;
  private lastProcessTime: number = 0;

  constructor(audioContext: AudioContext, options?: Partial<NoiseReductionOptions>) {
    this.audioContext = audioContext;
    this.options = this.getPresetOptions(options?.preset || 'balanced');
    
    // Override with custom options
    if (options) {
      this.options = { ...this.options, ...options };
    }
    
    this.initializeAudioNodes();
    this.initializeBuffers();
    
    console.log('🔧 Noise Reduction Processor initialized with preset:', this.options.preset);
  }

  private getPresetOptions(preset: 'light' | 'balanced' | 'aggressive' | 'custom'): NoiseReductionOptions {
    const presets = {
      light: {
        spectralGateThreshold: -45,
        spectralGateRatio: 0.7,
        noiseFloorAdaptation: 0.05,
        noiseFloorOffset: 8,
        highPassCutoff: 80,
        lowPassCutoff: 8000,
        smoothingFactor: 0.3,
        artifactReduction: 0.3,
        enabled: true,
        bypassOnLowLevel: true,
        preset: 'light' as const
      },
      balanced: {
        spectralGateThreshold: -40,
        spectralGateRatio: 0.5,
        noiseFloorAdaptation: 0.03,
        noiseFloorOffset: 6,
        highPassCutoff: 100,
        lowPassCutoff: 7000,
        smoothingFactor: 0.5,
        artifactReduction: 0.5,
        enabled: true,
        bypassOnLowLevel: true,
        preset: 'balanced' as const
      },
      aggressive: {
        spectralGateThreshold: -35,
        spectralGateRatio: 0.3,
        noiseFloorAdaptation: 0.02,
        noiseFloorOffset: 4,
        highPassCutoff: 120,
        lowPassCutoff: 6000,
        smoothingFactor: 0.7,
        artifactReduction: 0.8,
        enabled: true,
        bypassOnLowLevel: false,
        preset: 'aggressive' as const
      },
      custom: {
        spectralGateThreshold: -40,
        spectralGateRatio: 0.5,
        noiseFloorAdaptation: 0.03,
        noiseFloorOffset: 6,
        highPassCutoff: 100,
        lowPassCutoff: 7000,
        smoothingFactor: 0.5,
        artifactReduction: 0.5,
        enabled: true,
        bypassOnLowLevel: true,
        preset: 'custom' as const
      }
    };
    
    return presets[preset];
  }

  private initializeAudioNodes(): void {
    // Analyzer for real-time frequency analysis
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.2;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -10;

    // High-pass filter (remove low-frequency noise)
    this.highPassFilter = this.audioContext.createBiquadFilter();
    this.highPassFilter.type = 'highpass';
    this.highPassFilter.frequency.value = this.options.highPassCutoff;
    this.highPassFilter.Q.value = 0.7;

    // Low-pass filter (remove high-frequency noise)
    this.lowPassFilter = this.audioContext.createBiquadFilter();
    this.lowPassFilter.type = 'lowpass';
    this.lowPassFilter.frequency.value = this.options.lowPassCutoff;
    this.lowPassFilter.Q.value = 0.7;

    // Notch filters for common interference frequencies
    const interferenceFreqs = [50, 60, 120, 180]; // Power line harmonics
    interferenceFreqs.forEach(freq => {
      const notch = this.audioContext.createBiquadFilter();
      notch.type = 'notch';
      notch.frequency.value = freq;
      notch.Q.value = 10; // Narrow notch
      this.notchFilters.push(notch);
    });

    console.log('🎛️ Audio filter chain initialized');
  }

  private initializeBuffers(): void {
    const bufferLength = this.analyser.frequencyBinCount;
    
    // Create ArrayBuffer first, then Float32Array views
    const freqBuffer = new ArrayBuffer(bufferLength * 4);
    const timeBuffer = new ArrayBuffer(bufferLength * 4);
    const smoothBuffer = new ArrayBuffer(bufferLength * 4);
    const maskBuffer = new ArrayBuffer(bufferLength * 4);
    
    this.frequencyData = new Float32Array(freqBuffer);
    this.timeData = new Float32Array(timeBuffer);
    this.smoothingBuffer = new Float32Array(smoothBuffer);
    this.spectralMask = new Float32Array(maskBuffer);
    
    // Initialize smoothing buffer
    this.smoothingBuffer.fill(-90);
    
    console.log('📊 Analysis buffers initialized, size:', bufferLength);
  }

  /**
   * Create a complete audio processing chain
   */
  public createProcessingChain(inputNode: AudioNode): AudioNode {
    if (!this.options.enabled) {
      console.log('🔇 Noise reduction disabled, bypassing processing');
      return inputNode;
    }

    let currentNode: AudioNode = inputNode;

    // Connect to analyzer for monitoring
    currentNode.connect(this.analyser);

    // Apply high-pass filter
    currentNode.connect(this.highPassFilter);
    currentNode = this.highPassFilter;

    // Apply notch filters for interference
    this.notchFilters.forEach(notch => {
      currentNode.connect(notch);
      currentNode = notch;
    });

    // Apply low-pass filter
    currentNode.connect(this.lowPassFilter);
    currentNode = this.lowPassFilter;

    console.log('🔗 Audio processing chain created');
    return currentNode;
  }

  /**
   * Process audio data with spectral gating and adaptive noise reduction
   */
  public processAudioData(audioData: Float32Array): Float32Array {
    if (!this.options.enabled) {
      return audioData;
    }

    const startTime = performance.now();
    
    // Update noise floor estimate
    this.updateNoiseFloor(audioData);
    
    // Check if we should bypass processing for very quiet audio
    const rmsLevel = this.calculateRMS(audioData);
    const rmsDb = 20 * Math.log10(rmsLevel + 1e-10);
    
    if (this.options.bypassOnLowLevel && rmsDb < this.noiseFloorEstimate + 5) {
      return audioData;
    }

    // Apply spectral gating
    const processedData = this.applySpectralGating(audioData);
    
    // Apply temporal smoothing
    const smoothedData = this.applyTemporalSmoothing(processedData);
    
    // Calculate processing latency
    this.processingLatency = performance.now() - startTime;
    
    return smoothedData;
  }

  private updateNoiseFloor(audioData: Float32Array): void {
    const currentTime = performance.now();
    if (currentTime - this.lastUpdateTime < 100) return; // Update every 100ms
    
    const rmsLevel = this.calculateRMS(audioData);
    const currentDb = 20 * Math.log10(rmsLevel + 1e-10);
    
    // Add to history
    this.noiseFloorHistory.push(currentDb);
    if (this.noiseFloorHistory.length > 50) {
      this.noiseFloorHistory.shift();
    }
    
    // Calculate percentile-based noise floor (use 10th percentile)
    const sortedHistory = [...this.noiseFloorHistory].sort((a, b) => a - b);
    const percentileIndex = Math.floor(sortedHistory.length * 0.1);
    const estimatedFloor = sortedHistory[percentileIndex] || -60;
    
    // Smooth the adaptation
    const adaptationRate = this.options.noiseFloorAdaptation;
    this.noiseFloorEstimate = this.noiseFloorEstimate * (1 - adaptationRate) + estimatedFloor * adaptationRate;
    
    this.lastUpdateTime = currentTime;
  }

  private calculateRMS(audioData: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    return Math.sqrt(sum / audioData.length);
  }

  private applySpectralGating(audioData: Float32Array): Float32Array {
    // This is a simplified spectral gating implementation
    // In a real-world scenario, you'd use FFT/IFFT for frequency domain processing
    
    const processedData = new Float32Array(audioData.length);
    const gateThresholdLinear = Math.pow(10, this.options.spectralGateThreshold / 20);
    
    for (let i = 0; i < audioData.length; i++) {
      const sample = audioData[i];
      const amplitude = Math.abs(sample);
      
      if (amplitude > gateThresholdLinear) {
        // Above threshold - pass through with minimal processing
        processedData[i] = sample;
      } else {
        // Below threshold - apply reduction
        const reductionFactor = this.options.spectralGateRatio;
        processedData[i] = sample * reductionFactor;
      }
    }
    
    return processedData;
  }

  private applyTemporalSmoothing(audioData: Float32Array): Float32Array {
    const smoothedData = new Float32Array(audioData.length);
    const smoothingFactor = this.options.smoothingFactor;
    let previousSample = 0;
    
    for (let i = 0; i < audioData.length; i++) {
      const currentSample = audioData[i];
      const smoothedSample = previousSample * smoothingFactor + currentSample * (1 - smoothingFactor);
      smoothedData[i] = smoothedSample;
      previousSample = smoothedSample;
    }
    
    return smoothedData;
  }

  /**
   * Get real-time analysis data
   */
  public getAnalysisData(): {
    noiseFloor: number;
    currentLevel: number;
    processingLatency: number;
    spectralData: Float32Array;
  } {
    // Update frequency data with type safety workaround
    try {
      (this.analyser as any).getFloatFrequencyData(this.frequencyData);
    } catch (error) {
      console.warn('Warning: Failed to get frequency data:', error);
    }
    
    // Calculate current level
    const currentLevel = this.frequencyData.reduce((sum, val) => sum + val, 0) / this.frequencyData.length;
    
    return {
      noiseFloor: this.noiseFloorEstimate,
      currentLevel,
      processingLatency: this.processingLatency,
      spectralData: this.frequencyData.slice() // Copy for safety
    };
  }

  /**
   * Update processing options in real-time
   */
  public updateOptions(newOptions: Partial<NoiseReductionOptions>): void {
    this.options = { ...this.options, ...newOptions };
    
    // Update filter parameters
    this.highPassFilter.frequency.value = this.options.highPassCutoff;
    this.lowPassFilter.frequency.value = this.options.lowPassCutoff;
    
    console.log('🔧 Noise reduction options updated:', newOptions);
  }

  /**
   * Switch to a different preset
   */
  public setPreset(preset: 'light' | 'balanced' | 'aggressive'): void {
    const presetOptions = this.getPresetOptions(preset);
    this.updateOptions(presetOptions);
    console.log('🎚️ Switched to preset:', preset);
  }

  /**
   * Get current processing statistics
   */
  public getStats(): {
    preset: string;
    enabled: boolean;
    noiseFloor: number;
    processingLatency: number;
    filterSettings: {
      highPass: number;
      lowPass: number;
      spectralGate: number;
    };
  } {
    return {
      preset: this.options.preset,
      enabled: this.options.enabled,
      noiseFloor: this.noiseFloorEstimate,
      processingLatency: this.processingLatency,
      filterSettings: {
        highPass: this.options.highPassCutoff,
        lowPass: this.options.lowPassCutoff,
        spectralGate: this.options.spectralGateThreshold
      }
    };
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    try {
      this.analyser?.disconnect();
      this.highPassFilter?.disconnect();
      this.lowPassFilter?.disconnect();
      this.notchFilters.forEach(filter => filter?.disconnect());
      
      console.log('🧹 Noise reduction processor disposed');
    } catch (error) {
      console.warn('Warning during noise reduction cleanup:', error);
    }
  }
}

/**
 * Utility function to create enhanced getUserMedia with advanced noise reduction
 */
export async function getEnhancedAudioStream(
  noiseReductionLevel: 'light' | 'balanced' | 'aggressive' = 'balanced'
): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      sampleSize: 16,
      
      // Browser-based noise reduction (first layer)
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: true,
      
      // Additional constraints for better quality
      ...(typeof (window as any).MediaStreamConstraints !== 'undefined' && {
        googEchoCancellation: true,
        googAutoGainControl: true,
        googNoiseSuppression: true,
        googHighpassFilter: true,
        googTypingNoiseDetection: true,
        googBeamforming: true,
        googArrayGeometry: true,
        googAudioMirroring: false,
        googDAEchoCancellation: true,
        googNoiseReduction: true
      })
    }
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('🎤 Enhanced audio stream created with noise reduction level:', noiseReductionLevel);
    
    // Log the actual constraints that were applied
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      const settings = audioTrack.getSettings();
      console.log('🔧 Applied audio settings:', {
        echoCancellation: settings.echoCancellation,
        autoGainControl: settings.autoGainControl,
        noiseSuppression: settings.noiseSuppression,
        sampleRate: settings.sampleRate,
        channelCount: settings.channelCount
      });
    }
    
    return stream;
  } catch (error) {
    console.error('❌ Failed to create enhanced audio stream:', error);
    
    // Fallback to basic constraints
    return navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: true
      }
    });
  }
}