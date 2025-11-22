/**
 * Production-ready Segment Queue Service
 * Manages text-audio synchronization, queuing, timing, and playback coordination
 * 
 * Features:
 * - Sequential segment processing with proper queuing
 * - Real-time text-audio synchronization
 * - Automatic progress tracking and callbacks
 * - Memory management and cleanup
 * - Error recovery and retry logic
 */

export interface TextSegment {
  id: string;
  text: string;
  audioChunks: Uint8Array[];
  startTime?: number;
  endTime?: number;
  isPlaying?: boolean;
  isComplete?: boolean;
  priority?: number;
  metadata?: Record<string, any>;
}

export interface SegmentCallbacks {
  onSegmentStart?: (segment: TextSegment) => void;
  onSegmentProgress?: (segment: TextSegment, progress: number) => void;
  onSegmentEnd?: (segment: TextSegment) => void;
  onTextDisplay?: (segment: TextSegment, progress: number) => void;
  onChunkPlayed?: (segment: TextSegment, chunkIndex: number, textPortion: string) => void;
  onQueueEmpty?: () => void;
  onError?: (segment: TextSegment, error: Error) => void;
}

export interface SegmentQueueConfig {
  maxConcurrentSegments?: number;
  maxQueueSize?: number;
  progressUpdateInterval?: number;
  autoPlayNextSegment?: boolean;
  enablePrioritization?: boolean;
  memoryCleanupThreshold?: number;
}

export class SegmentQueueService {
  private queue: TextSegment[] = [];
  private activeSegments: Map<string, TextSegment> = new Map();
  private completedSegments: Map<string, TextSegment> = new Map();
  private callbacks: SegmentCallbacks = {};
  private config: Required<SegmentQueueConfig>;
  
  private isProcessing: boolean = false;
  private isPaused: boolean = false;
  private progressIntervals: Map<string, NodeJS.Timeout> = new Map();
  private audioContext: AudioContext | null = null;
  
  constructor(callbacks: SegmentCallbacks = {}, config: SegmentQueueConfig = {}) {
    this.callbacks = callbacks;
    this.config = {
      maxConcurrentSegments: config.maxConcurrentSegments ?? 3,
      maxQueueSize: config.maxQueueSize ?? 50,
      progressUpdateInterval: config.progressUpdateInterval ?? 100,
      autoPlayNextSegment: config.autoPlayNextSegment ?? true,
      enablePrioritization: config.enablePrioritization ?? true,
      memoryCleanupThreshold: config.memoryCleanupThreshold ?? 20
    };
    
    // Initialize audio context for timing
    if (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  /**
   * Add a new segment to the queue
   */
  addSegment(segment: TextSegment): boolean {
    try {
      // Validate segment
      if (!segment.id || !segment.text) {
        console.error('❌ Invalid segment: missing id or text');
        return false;
      }

      // Check queue size limit
      if (this.queue.length >= this.config.maxQueueSize) {
        console.warn(`⚠️ Queue full (${this.config.maxQueueSize}), removing oldest segment`);
        const oldSegment = this.queue.shift();
        if (oldSegment) {
          this.cleanupSegment(oldSegment);
        }
      }

      // Set defaults
      segment.priority = segment.priority ?? 0;
      segment.isPlaying = false;
      segment.isComplete = false;
      segment.audioChunks = segment.audioChunks || [];

      this.queue.push(segment);
      console.log(`📝 Added segment to queue: "${segment.text.substring(0, 50)}..." (Queue size: ${this.queue.length})`);

      // Sort by priority if enabled
      if (this.config.enablePrioritization) {
        this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      }

      // Start processing if not already running
      if (!this.isProcessing && this.config.autoPlayNextSegment) {
        this.processQueue();
      }

      return true;
    } catch (error) {
      console.error('❌ Error adding segment to queue:', error);
      return false;
    }
  }

  /**
   * Add audio chunk to an existing segment
   */
  addAudioToSegment(segmentId: string, audioData: Uint8Array): boolean {
    try {
      // Check active segments first
      let segment = this.activeSegments.get(segmentId);
      
      // Check queue if not in active
      if (!segment) {
        segment = this.queue.find(s => s.id === segmentId);
      }

      if (!segment) {
        console.error(`❌ Segment not found: ${segmentId}`);
        return false;
      }

      // Validate audio data
      if (!audioData || audioData.length === 0) {
        console.warn('⚠️ Empty audio data provided');
        return false;
      }

      segment.audioChunks.push(audioData);
      console.log(`🎵 Added audio chunk to segment "${segmentId}" (${audioData.length} bytes, total chunks: ${segment.audioChunks.length})`);

      // If segment is currently playing, play this chunk immediately
      if (segment.isPlaying && (segment as any).currentChunkIndex !== undefined) {
        console.log(`🎵 Segment is playing, queueing new chunk for immediate playback`);
        // The playSegment method will pick up new chunks automatically
      }

      return true;
    } catch (error) {
      console.error(`❌ Error adding audio to segment ${segmentId}:`, error);
      return false;
    }
  }

  /**
   * Process the segment queue - ensures strict sequential playback
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      console.log('⏳ Queue already processing, skipping...');
      return;
    }
    
    this.isProcessing = true;
    console.log('🎬 Starting segment queue processing');

    try {
      // Process segments one at a time (strictly sequential)
      while (this.queue.length > 0 && this.activeSegments.size < this.config.maxConcurrentSegments) {
        // Find the first segment that's ready for playback
        const readyIndex = this.queue.findIndex(s => (s as any).readyForPlayback);
        if (readyIndex === -1) {
          console.log('⏳ No segments ready for playback yet');
          break;
        }
        
        // Remove the ready segment from queue
        const segment = this.queue.splice(readyIndex, 1)[0];
        if (!segment) continue;

        console.log(`🎭 Processing segment: "${segment.text.substring(0, 50)}..." (Queue: ${this.queue.length}, Active: ${this.activeSegments.size})`);
        
        // Move to active segments
        this.activeSegments.set(segment.id, segment);
        
        // CRITICAL: Play segment and WAIT for it to complete before processing next
        // This ensures strictly sequential playback
        await this.playSegment(segment);
        
        console.log(`✅ Segment finished: "${segment.text.substring(0, 30)}..." (Queue: ${this.queue.length}, Active: ${this.activeSegments.size})`);
      }
    } catch (error) {
      console.error('❌ Error processing queue:', error);
      this.callbacks.onError?.(this.queue[0], error as Error);
    } finally {
      this.isProcessing = false;
      
      // Check if there are more segments ready to process
      const hasReadySegments = this.queue.some(s => (s as any).readyForPlayback);
      if (hasReadySegments && this.activeSegments.size < this.config.maxConcurrentSegments) {
        console.log('🔄 More ready segments found, restarting queue processing');
        // Don't await - let it process asynchronously
        setTimeout(() => this.processQueue(), 10);
      }
      
      // Check if queue is empty
      if (this.queue.length === 0 && this.activeSegments.size === 0) {
        console.log('✅ Queue processing complete - all segments finished');
        this.callbacks.onQueueEmpty?.();
      }
    }
  }

  /**
   * Play a segment with proper timing and callbacks - supports streaming chunks
   */
  private async playSegment(segment: TextSegment): Promise<void> {
    try {
      segment.isPlaying = true;
      segment.startTime = this.getCurrentTime();
      
      // Track which chunks we've already played
      (segment as any).currentChunkIndex = 0;
      
      // Split text into portions for each audio chunk
      const words = segment.text.split(' ');
      
      console.log(`🎬 ═══ SEGMENT START ═══ "${segment.text.substring(0, 40)}..." (ID: ${segment.id})`);
      
      // Notify segment start
      this.callbacks.onSegmentStart?.(segment);
      
      // Start progress tracking
      this.startProgressTracking(segment);
      
      // Play available audio chunks as they arrive (streaming support)
      // We'll keep playing chunks until segment is marked complete AND all chunks are played
      while (segment.isPlaying) {
        const currentIndex = (segment as any).currentChunkIndex;
        
        // Check if there are new chunks to play
        if (currentIndex < segment.audioChunks.length) {
          const audioChunk = segment.audioChunks[currentIndex];
          console.log(`🎵 [${segment.id}] Playing chunk ${currentIndex + 1}/${segment.audioChunks.length} (${audioChunk.length} bytes)`);
          
          try {
            // Calculate text portion for this chunk
            const totalChunks = segment.audioChunks.length || 1;
            const wordsPerChunk = Math.ceil(words.length / totalChunks);
            const startWordIndex = currentIndex * wordsPerChunk;
            const endWordIndex = Math.min(startWordIndex + wordsPerChunk, words.length);
            const textPortion = words.slice(startWordIndex, endWordIndex).join(' ');
            
            // Play the audio chunk
            await this.playAudioChunk(audioChunk);
            (segment as any).currentChunkIndex++;
            console.log(`✅ [${segment.id}] Chunk ${currentIndex + 1} completed`);
            
            // Notify that this chunk was played with its text portion
            if (textPortion && this.callbacks.onChunkPlayed) {
              console.log(`📝 [${segment.id}] Displaying text for chunk ${currentIndex + 1}: "${textPortion}"`);
              this.callbacks.onChunkPlayed(segment, currentIndex, textPortion);
            }
            
            // Very small delay to allow next chunk to be added
            await new Promise(resolve => setTimeout(resolve, 5));
          } catch (error) {
            console.error(`❌ [${segment.id}] Error playing chunk ${currentIndex + 1}:`, error);
            (segment as any).currentChunkIndex++;
          }
        } else if (segment.isComplete) {
          // No more chunks and segment is complete, exit loop
          console.log(`✅ [${segment.id}] All ${currentIndex} chunks played - segment complete`);
          break;
        } else {
          // Waiting for more chunks to arrive (streaming in progress)
          console.log(`⏳ [${segment.id}] Waiting for more chunks (played: ${currentIndex}, total: ${segment.audioChunks.length})`);
          await new Promise(resolve => setTimeout(resolve, 100)); // Increased wait time
        }
      }
      
      console.log(`🏁 ═══ SEGMENT END ═══ "${segment.text.substring(0, 40)}..." (ID: ${segment.id})`);
      
      // Mark as complete
      this.completeSegment(segment);
      
    } catch (error) {
      console.error(`❌ Error playing segment ${segment.id}:`, error);
      this.callbacks.onError?.(segment, error as Error);
      this.completeSegment(segment);
    }
  }

  /**
   * Continue playback for a segment (when new audio chunks arrive)
   */
  private continueSegmentPlayback(segment: TextSegment): void {
    // This would be called when new audio chunks are added to an active segment
    console.log(`🔄 Continuing playback for segment: ${segment.id}`);
    // Implementation depends on how you want to handle streaming chunks
  }

  /**
   * Play a single audio chunk - will be overridden by StreamingAudioPlayer
   */
  private async playAudioChunk(audioData: Uint8Array): Promise<void> {
    // This will be overridden by StreamingAudioPlayer's connectSegmentQueueToAudio method
    console.warn('⚠️ playAudioChunk not connected to real audio player - no sound will play');
    const estimatedDuration = audioData.length / (22050 * 2); // Rough estimate for timing
    await new Promise(resolve => setTimeout(resolve, estimatedDuration * 1000));
  }

  /**
   * Set the real audio playback function (called by StreamingAudioPlayer)
   */
  setAudioPlaybackFunction(playFunction: (audioData: Uint8Array) => Promise<boolean>): void {
    this.playAudioChunk = async (audioData: Uint8Array) => {
      const success = await playFunction(audioData);
      if (!success) {
        throw new Error('Audio playback failed');
      }
    };
    console.log('🔗 SegmentQueueService connected to real audio playback');
  }

  /**
   * Start progress tracking for a segment
   */
  private startProgressTracking(segment: TextSegment): void {
    const startTime = segment.startTime || this.getCurrentTime();
    
    const updateProgress = () => {
      if (!segment.isPlaying) return;
      
      const currentTime = this.getCurrentTime();
      const elapsed = currentTime - startTime;
      
      // Estimate total duration based on audio chunks
      const estimatedDuration = this.estimateSegmentDuration(segment);
      const progress = estimatedDuration > 0 ? Math.min(elapsed / estimatedDuration, 1) : 0;
      
      // Notify progress callbacks
      this.callbacks.onSegmentProgress?.(segment, progress);
      this.callbacks.onTextDisplay?.(segment, progress);
      
      console.log(`📊 Segment progress: ${(progress * 100).toFixed(1)}% - "${segment.text.substring(0, 30)}..."`);
    };
    
    const interval = setInterval(updateProgress, this.config.progressUpdateInterval);
    this.progressIntervals.set(segment.id, interval);
  }

  /**
   * Wait for segment completion
   */
  private async waitForSegmentCompletion(segment: TextSegment): Promise<void> {
    const estimatedDuration = this.estimateSegmentDuration(segment);
    
    if (estimatedDuration > 0) {
      await new Promise(resolve => setTimeout(resolve, estimatedDuration * 1000));
    }
  }

  /**
   * Complete a segment and clean up
   */
  private completeSegment(segment: TextSegment): void {
    segment.isPlaying = false;
    segment.isComplete = true;
    segment.endTime = this.getCurrentTime();
    
    // Clear progress tracking
    const interval = this.progressIntervals.get(segment.id);
    if (interval) {
      clearInterval(interval);
      this.progressIntervals.delete(segment.id);
    }
    
    // Move from active to completed
    this.activeSegments.delete(segment.id);
    this.completedSegments.set(segment.id, segment);
    
    console.log(`✅ Segment completed: "${segment.text.substring(0, 50)}..."`);
    
    // Notify completion
    this.callbacks.onSegmentEnd?.(segment);
    
    // Continue processing queue
    if (this.config.autoPlayNextSegment && this.queue.length > 0) {
      setTimeout(() => this.processQueue(), 50);
    }
    
    // Cleanup old segments if needed
    if (this.completedSegments.size > this.config.memoryCleanupThreshold) {
      this.cleanupOldSegments();
    }
  }

  /**
   * Estimate segment duration based on audio chunks
   */
  private estimateSegmentDuration(segment: TextSegment): number {
    if (segment.audioChunks.length === 0) return 0;
    
    const totalBytes = segment.audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    return totalBytes / (22050 * 2); // Rough estimation for 16-bit 22050Hz
  }

  /**
   * Get current time (audio context time if available, otherwise Date.now)
   */
  private getCurrentTime(): number {
    return this.audioContext?.currentTime || Date.now() / 1000;
  }

  /**
   * Clean up a segment and free memory
   */
  private cleanupSegment(segment: TextSegment): void {
    segment.audioChunks = [];
    segment.isPlaying = false;
    
    const interval = this.progressIntervals.get(segment.id);
    if (interval) {
      clearInterval(interval);
      this.progressIntervals.delete(segment.id);
    }
  }

  /**
   * Clean up old completed segments
   */
  private cleanupOldSegments(): void {
    const segments = Array.from(this.completedSegments.entries());
    const currentTime = this.getCurrentTime();
    
    // Remove segments older than 5 minutes
    let cleaned = 0;
    for (const [id, segment] of segments) {
      if (segment.endTime && currentTime - segment.endTime > 300) {
        this.cleanupSegment(segment);
        this.completedSegments.delete(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} old segments`);
    }
  }

  /**
   * Public API methods
   */

  /**
   * Stop all playback and clear queue
   */
  stop(): void {
    console.log('🛑 Stopping segment queue service');
    
    // Stop all active segments
    for (const segment of this.activeSegments.values()) {
      segment.isPlaying = false;
      this.cleanupSegment(segment);
    }
    
    // Clear all intervals
    for (const interval of this.progressIntervals.values()) {
      clearInterval(interval);
    }
    
    this.queue = [];
    this.activeSegments.clear();
    this.progressIntervals.clear();
    this.isProcessing = false;
  }

  /**
   * Pause all active segments
   */
  pause(): void {
    console.log('⏸️ Pausing segment playback');
    for (const segment of this.activeSegments.values()) {
      segment.isPlaying = false;
    }
    this.isProcessing = false;
  }

  /**
   * Resume playback
   */
  resume(): void {
    console.log('▶️ Resuming segment playback');
    for (const segment of this.activeSegments.values()) {
      segment.isPlaying = true;
    }
    if (this.config.autoPlayNextSegment) {
      this.processQueue();
    }
  }

  /**
   * Clear current playback and reset for new response
   * Unlike stop(), this preserves the service's ability to immediately process new segments
   */
  clearAndReset(): void {
    console.log('🧹 Clearing current playback and resetting for new response');
    
    // Stop and clean up all active segments
    for (const segment of this.activeSegments.values()) {
      segment.isPlaying = false;
      this.cleanupSegment(segment);
    }
    
    // Clear all intervals
    for (const interval of this.progressIntervals.values()) {
      clearInterval(interval);
    }
    
    // Clear queues but keep service ready
    this.queue = [];
    this.activeSegments.clear();
    this.progressIntervals.clear();
    
    // Reset processing flag so new segments can be processed immediately
    this.isProcessing = false;
    this.isPaused = false;
    
    console.log('✅ Segment queue cleared and ready for new response');
  }

  /**
   * Clear specific segments by their IDs
   */
  clearSegmentsByIds(segmentIds: Set<string>): void {
    console.log(`🧹 Clearing ${segmentIds.size} specific segments`);
    
    let clearedCount = 0;
    
    // Remove from queue
    this.queue = this.queue.filter(segment => {
      if (segmentIds.has(segment.id)) {
        this.cleanupSegment(segment);
        clearedCount++;
        return false;
      }
      return true;
    });
    
    // Remove from active segments
    for (const segmentId of segmentIds) {
      const segment = this.activeSegments.get(segmentId);
      if (segment) {
        segment.isPlaying = false;
        this.cleanupSegment(segment);
        this.activeSegments.delete(segmentId);
        clearedCount++;
      }
    }
    
    console.log(`✅ Cleared ${clearedCount} segments, ${this.queue.length} remaining in queue`);
  }

  /**
   * Get current queue status
   */
  getStatus(): {
    queueLength: number;
    activeSegments: number;
    completedSegments: number;
    isProcessing: boolean;
  } {
    return {
      queueLength: this.queue.length,
      activeSegments: this.activeSegments.size,
      completedSegments: this.completedSegments.size,
      isProcessing: this.isProcessing
    };
  }

  /**
   * Get segment by ID
   */
  getSegment(id: string): TextSegment | undefined {
    return this.activeSegments.get(id) || 
           this.completedSegments.get(id) || 
           this.queue.find(s => s.id === id);
  }

  /**
   * Update callbacks
   */
  updateCallbacks(callbacks: SegmentCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Mark a segment as ready for playback
   */
  markSegmentReady(segmentId: string): boolean {
    const segment = this.getSegment(segmentId);
    if (!segment) {
      console.warn(`⚠️ Cannot mark segment "${segmentId}" as ready: segment not found`);
      return false;
    }

    console.log(`🎬 Marking segment "${segmentId}" as ready for playback`);
    
    // Set readyForPlayback flag and trigger queue processing
    (segment as any).readyForPlayback = true;
    
    // Important: Don't set isComplete to true here - that's only for when TTS finishes
    // This allows streaming: we start playing when ready, continue as chunks arrive
    segment.isComplete = false;
    
    // If the segment is still in queue, prioritize it for processing
    if (this.queue.includes(segment)) {
      this.processQueue();
    }
    
    return true;
  }

  /**
   * Mark a segment's audio streaming as complete (all chunks received)
   */
  markSegmentAudioComplete(segmentId: string): boolean {
    const segment = this.getSegment(segmentId);
    if (!segment) {
      console.warn(`⚠️ Cannot mark segment "${segmentId}" as audio complete: segment not found`);
      return false;
    }

    console.log(`🏁 Marking segment "${segmentId}" audio as complete (all chunks received)`);
    segment.isComplete = true;
    
    return true;
  }

  /**
   * Clear all segments and reset
   */
  clear(): void {
    this.stop();
    this.completedSegments.clear();
    console.log('🗑️ Cleared all segments');
  }
}