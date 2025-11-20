/**
 * Audio Queue Manager for sequential audio playback
 * Handles chunked TTS audio streaming with seamless playback
 */

export class AudioQueue {
  private queue: string[] = [];
  private isPlaying: boolean = false;
  private currentAudio: HTMLAudioElement | null = null;
  private onComplete?: () => void;
  private stopRequested: boolean = false; // flag to abort playback chain
  private activeUrls: Set<string> = new Set();

  constructor(onComplete?: () => void) {
    this.onComplete = onComplete;
  }

  /**
   * Add audio URL to the queue
   */
  enqueue(audioUrl: string): void {
    if (this.stopRequested) {
      console.log('🚫 Ignoring enqueue because stopRequested is true');
      return;
    }
    console.log('🎵 Enqueuing audio:', audioUrl);
    this.queue.push(audioUrl);
    this.activeUrls.add(audioUrl);
    
    // Start playing if not already playing
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  /**
   * Add multiple audio URLs to the queue
   */
  enqueueMultiple(audioUrls: string[]): void {
    if (this.stopRequested) {
      console.log('🚫 Ignoring enqueueMultiple because stopRequested is true');
      return;
    }
    console.log('🎵 Enqueuing multiple audio chunks:', audioUrls.length);
    this.queue.push(...audioUrls);
    audioUrls.forEach(u => this.activeUrls.add(u));
    
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  /**
   * Play the next audio in queue
   */
  private async playNext(): Promise<void> {
    if (this.stopRequested) {
      console.log('⏹️ Stop requested - aborting playback chain');
      this.queue = [];
      this.isPlaying = false;
      return;
    }
    if (this.queue.length === 0) {
      this.isPlaying = false;
      console.log('✅ Audio queue completed');
      
      // Call completion callback
      if (this.onComplete) {
        this.onComplete();
      }
      return;
    }

    this.isPlaying = true;
    const audioUrl = this.queue.shift()!;
    
    console.log('▶️ Playing audio:', audioUrl);
    
    try {
      if (this.stopRequested) {
        console.log('⏹️ Stop requested before creating Audio element');
        this.queue = [];
        this.isPlaying = false;
        return;
      }
      this.currentAudio = new Audio(audioUrl);
      this.currentAudio.preload = 'auto';
      
      // Handle audio end - play next in queue
      this.currentAudio.onended = () => {
        console.log('✅ Audio chunk completed');
        this.currentAudio = null;
        if (!this.stopRequested) {
          this.playNext();
        } else {
          console.log('⏹️ Playback chain halted after chunk end');
          this.queue = [];
          this.isPlaying = false;
        }
      };
      
      // Handle audio errors
      this.currentAudio.onerror = (error) => {
        console.error('❌ Audio playback error:', error);
        this.currentAudio = null;
        if (!this.stopRequested) {
          this.playNext(); // Try next audio
        } else {
          console.log('⏹️ Error occurred but stop already requested; not continuing');
          this.queue = [];
          this.isPlaying = false;
        }
      };
      
      // Start playback
      const playPromise = this.currentAudio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        await playPromise.catch(err => {
          console.warn('⚠️ play() rejected:', err);
        });
      }
      
    } catch (error) {
      console.error('❌ Error playing audio:', error);
      this.currentAudio = null;
      if (!this.stopRequested) {
        this.playNext(); // Try next audio
      } else {
        console.log('⏹️ Aborting after error due to stop request');
        this.queue = [];
        this.isPlaying = false;
      }
    }
  }

  /**
   * Stop current playback and clear queue
   */
  stop(): void {
    console.log('🛑 Stopping audio queue');
    this.stopRequested = true;
    
    if (this.currentAudio) {
      try {
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        // Attempt to unload
        const src = this.currentAudio.src;
        this.currentAudio.removeAttribute('src');
        this.currentAudio.load();
        if (src && this.activeUrls.has(src)) {
          URL.revokeObjectURL(src);
          this.activeUrls.delete(src);
        }
      } catch (e) {
        console.warn('⚠️ Error during hard stop cleanup', e);
      }
      this.currentAudio = null;
    }
    
    this.queue = [];
    this.isPlaying = false;
  }

  /**
   * Stop all playback (alias for stop for clarity)
   */
  stopAll(): void {
    this.stop();
  }

  /**
   * Clear the queue without stopping current playback
   */
  clear(): void {
    console.log('🗑️ Clearing audio queue');
    this.queue = [];
  }

  /**
   * Pause current audio
   */
  pause(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.isPlaying = false;
    }
  }

  /**
   * Resume paused audio
   */
  resume(): void {
    if (this.currentAudio && !this.isPlaying) {
      this.stopRequested = false;
      this.currentAudio.play();
      this.isPlaying = true;
    }
  }

  /**
   * Get current queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if audio is currently playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Force reset stop flag (for new session of audio playback)
   */
  resetStopFlag(): void {
    this.stopRequested = false;
  }

  /**
   * External check for stopped state
   */
  isStopped(): boolean {
    return this.stopRequested;
  }
}
