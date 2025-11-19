/**
 * Audio Queue Manager for sequential audio playback
 * Handles chunked TTS audio streaming with seamless playback
 */

export class AudioQueue {
  private queue: string[] = [];
  private isPlaying: boolean = false;
  private currentAudio: HTMLAudioElement | null = null;
  private onComplete?: () => void;

  constructor(onComplete?: () => void) {
    this.onComplete = onComplete;
  }

  /**
   * Add audio URL to the queue
   */
  enqueue(audioUrl: string): void {
    console.log('🎵 Enqueuing audio:', audioUrl);
    this.queue.push(audioUrl);
    
    // Start playing if not already playing
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  /**
   * Add multiple audio URLs to the queue
   */
  enqueueMultiple(audioUrls: string[]): void {
    console.log('🎵 Enqueuing multiple audio chunks:', audioUrls.length);
    this.queue.push(...audioUrls);
    
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  /**
   * Play the next audio in queue
   */
  private async playNext(): Promise<void> {
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
      this.currentAudio = new Audio(audioUrl);
      
      // Handle audio end - play next in queue
      this.currentAudio.onended = () => {
        console.log('✅ Audio chunk completed');
        this.currentAudio = null;
        this.playNext();
      };
      
      // Handle audio errors
      this.currentAudio.onerror = (error) => {
        console.error('❌ Audio playback error:', error);
        this.currentAudio = null;
        this.playNext(); // Try next audio
      };
      
      // Start playback
      await this.currentAudio.play();
      
    } catch (error) {
      console.error('❌ Error playing audio:', error);
      this.currentAudio = null;
      this.playNext(); // Try next audio
    }
  }

  /**
   * Stop current playback and clear queue
   */
  stop(): void {
    console.log('🛑 Stopping audio queue');
    
    if (this.currentAudio) {
      this.currentAudio.pause();
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
}
