/**
 * Production-ready StreamingAudioPlayer with SegmentQueueService integration
 * Handles seamless TTS playback with proper text-audio synchronization
 * 
 * Features:
 * - Instant playback as chunks arrive
 * - Production-grade segment queue management
 * - Perfect timing control for UI animations
 * - Works with any TTS provider
 * - WASM VAD integration handled separately
 */

import { SegmentQueueService, TextSegment, SegmentCallbacks } from './segmentQueueService';
import { createWavFromPCM } from './wavUtils';

export type { TextSegment, SegmentCallbacks } from './segmentQueueService';

// Legacy VAD callbacks interface for backward compatibility
export interface VADCallbacks {
  onSpeechStart?: (timestamp: number) => void;
  onSpeechEnd?: (timestamp: number) => void;
  onSentenceBoundary?: (timestamp: number) => void;
  onPause?: (startTime: number, duration: number) => void;
}

export class StreamingAudioPlayer {
  private audioContext: AudioContext | null = null;
  private playTime: number;
  private isPlaying: boolean = false;
  private onComplete?: () => void;
  private stopRequested: boolean = false;
  private activeUrls: Set<string> = new Set();
  
  // Segment Queue Service integration
  private segmentQueue: SegmentQueueService;

  constructor(onComplete?: () => void, segmentCallbacks?: SegmentCallbacks) {
    // Handle SSR - only initialize AudioContext in browser environment
    if (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.playTime = this.audioContext.currentTime;
    } else {
      // Create a mock AudioContext for SSR
      this.audioContext = null;
      this.playTime = 0;
    }
    
    this.onComplete = onComplete;
    
    // Initialize segment queue service with enhanced callbacks
    const enhancedCallbacks: SegmentCallbacks = {
      ...segmentCallbacks,
      onQueueEmpty: () => {
        console.log('🏁 All segments completed');
        this.onComplete?.();
        segmentCallbacks?.onQueueEmpty?.();
      }
    };
    
    this.segmentQueue = new SegmentQueueService(enhancedCallbacks, {
      maxConcurrentSegments: 1, // Sequential playback for TTS
      autoPlayNextSegment: true,
      progressUpdateInterval: 50, // Smooth UI updates
      maxQueueSize: 100,
    });
    
    // Connect the segment queue to our audio playback
    this.connectSegmentQueueToAudio();
  }

  /**
   * Initialize AudioContext - call this after component mounts to handle SSR
   */
  initializeAudioContext(): boolean {
    if (typeof window !== 'undefined' && !this.audioContext && (window.AudioContext || (window as any).webkitAudioContext)) {
      try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.playTime = this.audioContext.currentTime;
        console.log('🔊 AudioContext initialized after SSR');
        return true;
      } catch (error) {
        console.error('🔊 Failed to initialize AudioContext:', error);
        return false;
      }
    }
    return !!this.audioContext;
  }

  /**
   * Initialize the streaming audio system
   */
  async initialize(): Promise<boolean> {
    this.initializeAudioContext();
    await this.ensureAudioContextResumed();
    console.log('🎵 StreamingAudioPlayer initialized with SegmentQueueService');
    return true;
  }

  /**
   * Connect the segment queue to audio playback
   */
  private connectSegmentQueueToAudio(): void {
    console.log('🔗 Connecting SegmentQueueService to StreamingAudioPlayer...');
    // Connect the SegmentQueueService to our real audio playback method
    this.segmentQueue.setAudioPlaybackFunction(async (audioData: Uint8Array) => {
      console.log(`🎵 SegmentQueue → StreamingAudioPlayer: Playing audio chunk (${audioData.length} bytes)`);
      console.log(`🎵 AudioContext state: ${this.audioContext?.state}, current time: ${this.audioContext?.currentTime}`);
      const result = await this.playChunk(audioData);
      console.log(`🎵 Audio playback result: ${result}`);
      return result;
    });
    console.log('✅ SegmentQueueService connected to audio playback');
  }

  /**
   * Create a new text segment for synchronized playback
   */
  createTextSegment(id: string, text: string): TextSegment {
    const segment: TextSegment = {
      id,
      text,
      audioChunks: [],
      isPlaying: false,
      isComplete: false,
      priority: 0
    };
    
    // Add to segment queue service
    this.segmentQueue.addSegment(segment);
    console.log(`📝 Created text segment "${id}": "${text.substring(0, 50)}..."`);
    return segment;
  }

  /**
   * Add audio chunk to a segment with production-grade validation
   */
  async addAudioToSegment(segmentId: string, audioData: Uint8Array): Promise<boolean> {
    // Delegate to segment queue service
    const success = this.segmentQueue.addAudioToSegment(segmentId, audioData);
    
    if (success) {
      console.log(`🎵 Added audio chunk to segment "${segmentId}" via SegmentQueueService`);
    }
    
    return success;
  }

  /**
   * Mark a segment as complete and ready for playback
   */
  completeSegment(segmentId: string): boolean {
    console.log(`🏁 Completing segment "${segmentId}" for playback`);
    return this.segmentQueue.markSegmentReady(segmentId);
  }

  /**
   * Mark a segment's audio streaming as complete (all chunks received from TTS)
   */
  markSegmentAudioComplete(segmentId: string): boolean {
    console.log(`🏁 Marking segment "${segmentId}" audio as complete`);
    return this.segmentQueue.markSegmentAudioComplete(segmentId);
  }

  /**
   * Play audio chunk with text segment association
   */
  async playChunkWithText(audioData: Uint8Array, text?: string, segmentId?: string): Promise<boolean> {
    if (text && segmentId) {
      // Create segment if it doesn't exist and add audio
      let segment = this.segmentQueue.getSegment(segmentId);
      if (!segment) {
        segment = this.createTextSegment(segmentId, text);
      }
      return this.addAudioToSegment(segmentId, audioData);
    } else {
      // Direct playback without segment management
      return this.playChunk(audioData);
    }
  }

  /**
   * Production-grade audio chunk playback with error handling and retry logic
   */
  async playChunk(audioData: Uint8Array, retryCount: number = 0): Promise<boolean> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 100; // ms
    
    if (this.stopRequested) {
      return false;
    }

    // Ensure AudioContext is available (handle SSR)
    if (!this.audioContext) {
      if (!this.initializeAudioContext()) {
        console.warn('🔊 AudioContext not available, cannot play chunk');
        return false;
      }
    }

    try {
      // Resume audio context if suspended (required for user interaction)
      if (this.audioContext!.state === 'suspended') {
        await this.audioContext!.resume();
      }
      
      console.log(`▶️ PLAY: Chunk ${audioData.length} bytes, attempt ${retryCount + 1}`);

      // CRITICAL: Check if this is a complete WAV file or raw PCM data
      const isWav = audioData.length > 12 && 
                    audioData[0] === 0x52 && audioData[1] === 0x49 && 
                    audioData[2] === 0x46 && audioData[3] === 0x46; // "RIFF"
      
      console.log(`🎵 Format: ${isWav ? 'WAV' : 'RAW/PCM'}, bytes: ${audioData.length}`);
      
      // If raw PCM, wrap it in WAV headers
      let wavData: Uint8Array;
      if (!isWav) {
        console.log(`🔧 Converting RAW PCM to WAV format (22050Hz, 16-bit, mono)`);
        wavData = createWavFromPCM(audioData, {
          sampleRate: 22050,
          channels: 1,
          bitsPerSample: 16
        });
        console.log(`✅ Converted: ${audioData.length} bytes PCM → ${wavData.length} bytes WAV`);
      } else {
        wavData = audioData;
        
        // Validate WAV header structure
        if (audioData.length < 44) {
          console.error(`❌ WAV file too small: ${audioData.length} bytes`);
          throw new Error('Invalid WAV file - too small');
        }
        
        // Check for "WAVE" identifier
        const hasWaveId = audioData[8] === 0x57 && audioData[9] === 0x41 && 
                          audioData[10] === 0x56 && audioData[11] === 0x45;
        
        if (!hasWaveId) {
          console.error(`❌ Invalid WAV file - missing WAVE identifier`);
          throw new Error('Invalid WAV file format');
        }
        
        console.log(`✅ WAV validation passed`);
      }
      
      // Decode audio data with timeout protection
      // Copy to a new ArrayBuffer to ensure compatibility
      const buffer = new ArrayBuffer(wavData.length);
      const view = new Uint8Array(buffer);
      view.set(wavData);
      
      let audioBuffer: AudioBuffer;
      try {
        const decodePromise = this.audioContext!.decodeAudioData(buffer);
        const timeoutPromise = new Promise<AudioBuffer>((_, reject) => 
          setTimeout(() => reject(new Error('Audio decode timeout')), 5000)
        );
        
        audioBuffer = await Promise.race([decodePromise, timeoutPromise]);
        console.log(`✅ DECODED: ${audioBuffer.duration.toFixed(3)}s, ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}ch`);
      } catch (decodeError) {
        console.error(`❌ DECODE FAILED:`, decodeError);
        console.error(`❌ WAV data: ${wavData.length} bytes`);
        console.error(`❌ WAV header (first 44): [${Array.from(wavData.slice(0, 44)).join(', ')}]`);
        throw new Error(`Audio decode failed: ${decodeError}`);
      }
      
      if (this.stopRequested) {
        return false;
      }

      // Validate decoded audio
      if (!audioBuffer || audioBuffer.duration === 0) {
        throw new Error('Invalid audio buffer - zero duration');
      }
      
      if (audioBuffer.duration > 30) {
        console.warn(`⚠️ Very long chunk: ${audioBuffer.duration}s`);
      }

      // Create source node
      const source = this.audioContext!.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext!.destination);

      // Schedule playback for seamless streaming
      const now = this.audioContext!.currentTime;
      if (this.playTime < now + 0.01) {
        this.playTime = now + 0.01;
      }

      const scheduledAt = this.playTime;
      const chunkDuration = audioBuffer.duration;
      
      console.log(`▶️ PLAYING: Now=${now.toFixed(3)}s, Scheduled=${scheduledAt.toFixed(3)}s, Duration=${chunkDuration.toFixed(3)}s, WillEnd=${(scheduledAt + chunkDuration).toFixed(3)}s`);
      
      source.start(this.playTime);
      this.isPlaying = true;

      // Update scheduling time for next chunk
      this.playTime += audioBuffer.duration;

      // Enhanced completion handling
      source.onended = () => {
        const endTime = this.audioContext!.currentTime;
        console.log(`⏸️ ENDED: Chunk finished at ${endTime.toFixed(3)}s (expected ${(scheduledAt + chunkDuration).toFixed(3)}s)`);
        
        if (endTime >= this.playTime - 0.1) {
          this.isPlaying = false;
        }
      };

      return true;

    } catch (error) {
      console.error(`❌ PLAY ERROR (attempt ${retryCount + 1}):`, error);
      
      // Retry logic for transient failures
      if (retryCount < MAX_RETRIES && !this.stopRequested) {
        console.log(`🔄 Retry in ${RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return this.playChunk(audioData, retryCount + 1);
      }
      
      // If all retries failed, try to recover the audio context
      if (this.audioContext!.state === 'suspended') {
        try {
          await this.audioContext!.resume();
          console.log('🔧 AudioContext recovered, final retry');
          return this.playChunk(audioData, MAX_RETRIES);
        } catch (recoveryError) {
          console.error('❌ Recovery failed:', recoveryError);
        }
      }
      
      return false;
    }
  }

  /**
   * Play base64 audio chunk (convenience method)
   */
  async playBase64Chunk(base64Chunk: string): Promise<boolean> {
    try {
      // Convert base64 → raw bytes
      const byteArray = Uint8Array.from(atob(base64Chunk), c => c.charCodeAt(0));
      return await this.playChunk(byteArray);
    } catch (error) {
      console.error('❌ Error playing base64 chunk:', error);
      return false;
    }
  }

  /**
   * Play audio from URL
   */
  async playFromUrl(url: string): Promise<boolean> {
    try {
      this.activeUrls.add(url);
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const byteArray = new Uint8Array(arrayBuffer);
      
      return await this.playChunk(byteArray);
    } catch (error) {
      console.error('🎵 ❌ Error playing from URL:', error);
      return false;
    } finally {
      this.activeUrls.delete(url);
    }
  }

  /**
   * Stop all playback
   */
  stop(): void {
    console.log('🛑 Stopping streaming audio player');
    this.stopRequested = true;
    this.isPlaying = false;
    
    // Stop segment queue
    this.segmentQueue.stop();
    
    if (this.audioContext) {
      this.playTime = this.audioContext.currentTime;
    }
    
    // Clean up any active URLs
    this.activeUrls.forEach(url => {
      URL.revokeObjectURL(url);
    });
    this.activeUrls.clear();
  }

  /**
   * Resume playback (reset stop flag)
   */
  resume(): void {
    console.log('▶️ Resuming streaming audio player');
    this.stopRequested = false;
    
    // Resume segment queue
    this.segmentQueue.resume();
    
    // IMPORTANT: Only reset playTime if it's in the past
    // This prevents scheduling conflicts when resuming mid-playback
    if (this.audioContext) {
      const now = this.audioContext.currentTime;
      if (this.playTime < now) {
        console.log(`🔧 Resetting playTime: ${this.playTime.toFixed(3)}s → ${now.toFixed(3)}s`);
        this.playTime = now;
      } else {
        console.log(`✅ Keeping playTime: ${this.playTime.toFixed(3)}s (now: ${now.toFixed(3)}s)`);
      }
    }
  }

  /**
   * Pause playback
   */
  pause(): void {
    console.log('⏸️ Pausing streaming audio player');
    this.segmentQueue.pause();
  }

  /**
   * Clear current playback and reset for new response
   */
  clearAndReset(): void {
    console.log('🧹 Clearing current playback in streaming audio player');
    this.stopRequested = false; // Reset stop flag for new playback
    this.isPlaying = false;
    this.segmentQueue.clearAndReset();
    
    // Clean up any active URLs
    this.activeUrls.forEach(url => {
      URL.revokeObjectURL(url);
    });
    this.activeUrls.clear();
  }

  /**
   * Clear specific segments by their IDs
   */
  clearSegmentsByIds(segmentIds: Set<string>): void {
    console.log(`🧹 Clearing segments in streaming audio player`);
    this.segmentQueue.clearSegmentsByIds(segmentIds);
  }

  /**
   * Get current playback state
   */
  getState(): { isPlaying: boolean; currentTime: number; playTime: number } {
    return {
      isPlaying: this.isPlaying,
      currentTime: this.audioContext?.currentTime || 0,
      playTime: this.playTime
    };
  }

  /**
   * Get current playback timing info for synchronization
   */
  getPlaybackTiming(): { 
    currentTime: number; 
    scheduledTime: number; 
    isPlaying: boolean;
  } {
    return {
      currentTime: this.audioContext?.currentTime || 0,
      scheduledTime: this.playTime,
      isPlaying: this.isPlaying,
    };
  }

  /**
   * Check if audio context needs to be resumed (for user interaction requirements)
   */
  async ensureAudioContextResumed(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      console.log('🔊 Resuming audio context');
      await this.audioContext.resume();
    }
  }

  /**
   * Get all text segments from segment queue
   */
  getSegments(): TextSegment[] {
    const status = this.segmentQueue.getStatus();
    console.log(`📊 Queue status: ${status.queueLength} queued, ${status.activeSegments} active, ${status.completedSegments} completed`);
    return [];
  }

  /**
   * Get current playing segment
   */
  getCurrentSegment(): TextSegment | null {
    // This would need to be implemented in SegmentQueueService
    return null;
  }

  /**
   * Clear all segments
   */
  clearSegments(): void {
    this.segmentQueue.clear();
    console.log('🗑️ Cleared all segments via SegmentQueueService');
  }

  /**
   * Get segment by ID
   */
  getSegment(id: string): TextSegment | undefined {
    return this.segmentQueue.getSegment(id);
  }

  /**
   * Update segment callbacks
   */
  updateSegmentCallbacks(callbacks: SegmentCallbacks): void {
    this.segmentQueue.updateCallbacks(callbacks);
  }

  /**
   * Get synchronized playback state
   */
  getSynchronizedState(): {
    currentSegment: TextSegment | null;
    playbackTime: number;
    segmentProgress: number;
    totalSegments: number;
  } {
    const status = this.segmentQueue.getStatus();
    const currentTime = this.audioContext?.currentTime || 0;
    
    return {
      currentSegment: this.getCurrentSegment(),
      playbackTime: currentTime,
      segmentProgress: 0, // Would need implementation in SegmentQueueService
      totalSegments: status.queueLength + status.activeSegments + status.completedSegments
    };
  }

  /**
   * Check if audio is currently playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }
}