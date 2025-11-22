"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { AudioQueue } from "@/lib/audioQueue";
import { StreamingAudioPlayer, TextSegment } from "@/lib/streamingAudioPlayer";
import { grpcSTTService } from "@/lib/grpcSTTService";
import { grpcTTSService } from "@/lib/grpcTTSService";
import { NoiseReductionProcessor, getEnhancedAudioStream, type NoiseReductionOptions } from "@/lib/noiseCancellation";

// Declare global vad interface
declare global {
  interface Window {
    vad: any;
    ort: any;
  }
}
import { sanitizeForTTS } from "@/lib/textSanitizer";
import { testBase64AudioPlayback } from "@/lib/audioTest";
import { ensureWavFormat } from "@/lib/wavUtils";
import ConversationPanel from "./ConversationPanel";
import { 
  generateChatStream, 
  createAudioUrl,
  createSession,
  deleteSession,
  type Message as ApiMessage 
} from "@/lib/apiService";

// TEMP workaround: Some build environments failing to pick up JSX intrinsic element types.
// This fallback keeps compilation moving; remove once underlying TS/React type resolution fixed.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      div: any; span: any; p: any; h1: any; svg: any; path: any; circle: any; button: any; select: any; option: any; style: any; }
  }
}

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Status = "idle" | "recording" | "transcribing" | "processing" | "thinking" | "speaking";

// Test messages for UI development
const TEST_MESSAGES: Message[] = [
  { role: "user", content: "Testing the new gRPC STT server integration." },
  { role: "assistant", content: "Great! The gRPC STT server provides high-performance speech-to-text capabilities with better throughput and lower latency than REST APIs." },
  { role: "user", content: "What are the benefits of gRPC?" },
  { role: "assistant", content: "gRPC offers several advantages: binary protocol for faster data transfer, built-in streaming support, strong typing with Protocol Buffers, and language-agnostic client generation. It's perfect for microservices and real-time applications like voice assistants." },
];

// Utility function to convert Float32Array to WAV blob
function float32ToWav(float32Array: Float32Array, sampleRate: number): Blob {
  const length = float32Array.length;
  const arrayBuffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(arrayBuffer);
  
  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length * 2, true);
  
  // Convert float32 to int16
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, sample * 0x7FFF, true);
    offset += 2;
  }
  
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export default function GrpcVoiceAssistant() {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [language, setLanguage] = useState("en");
  const [isVadReady, setIsVadReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [vadMode, setVadMode] = useState<'adaptive' | 'ultra' | 'fast' | 'balanced' | 'reliable'>('balanced');
  const [adaptiveEffectiveMode, setAdaptiveEffectiveMode] = useState<'ultra' | 'fast' | 'balanced' | 'reliable'>('balanced');
  
  // gRPC-specific state
  const [grpcModel, setGrpcModel] = useState("distil-medium.en");
  const [grpcCapabilities, setGrpcCapabilities] = useState<any>(null);
  const [partialTranscription, setPartialTranscription] = useState<string>('');
  const [useGrpcSTT, setUseGrpcSTT] = useState(true);
  
  // New VAD state for direct API
  const [vadInstance, setVadInstance] = useState<any>(null);
  const [vadReady, setVadReady] = useState(false);
  const [vadError, setVadError] = useState<string | null>(null);
  const [vadLoading, setVadLoading] = useState(true);
  const graceMs = 150;
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const graceRecorderRef = useRef<MediaRecorder | null>(null);
  const graceChunksRef = useRef<Blob[]>([]);
  const isCapturingRef = useRef<boolean>(false);

  // TTS playback state
  const [isTTSPlaying, setIsTTSPlaying] = useState(false);

  // Noise cancellation state
  const [noiseCancellationEnabled, setNoiseCancellationEnabled] = useState(true);
  const [noiseCancellationLevel, setNoiseCancellationLevel] = useState<'light' | 'balanced' | 'aggressive'>('balanced');
  const [noiseStats, setNoiseStats] = useState<{
    noiseFloor: number;
    currentLevel: number;
    processingLatency: number;
    enabled: boolean;
  }>({
    noiseFloor: -60,
    currentLevel: -60,
    processingLatency: 0,
    enabled: false
  });
  const noiseProcessorRef = useRef<NoiseReductionProcessor | null>(null);

  // Lazy init microphone stream for grace buffer capture
  const ensureMediaStream = async () => {
    if (mediaStreamRef.current) return mediaStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      return stream;
    } catch (err) {
      console.warn('[GraceCapture] Failed to access microphone for grace buffer:', err);
      return null;
    }
  };

  // Capture small grace buffer after VAD end
  const captureGraceBuffer = async (): Promise<Float32Array | null> => {
    const stream = await ensureMediaStream();
    if (!stream) return null;
    return new Promise((resolve) => {
      try {
        graceChunksRef.current = [];
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        graceRecorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) graceChunksRef.current.push(e.data);
        };
        recorder.onstop = async () => {
          try {
            const blob = new Blob(graceChunksRef.current, { type: 'audio/webm' });
            const arrayBuf = await blob.arrayBuffer();
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const decoded = await audioCtx.decodeAudioData(arrayBuf);
            const channelData = decoded.getChannelData(0);
            resolve(new Float32Array(channelData));
          } catch (e) {
            console.warn('[GraceCapture] decode failed', e);
            resolve(null);
          }
        };
        recorder.start();
        setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
        }, graceMs);
      } catch (e) {
        console.warn('[GraceCapture] recorder init failed', e);
        resolve(null);
      }
    });
  };

  const audioQueueRef = useRef<AudioQueue>(new AudioQueue());
  // Add state for current playing segment
  const [currentPlayingSegment, setCurrentPlayingSegment] = useState<string | null>(null);

  // Initialize StreamingAudioPlayer safely for SSR
  const streamingPlayerRef = useRef<StreamingAudioPlayer | null>(null);
  
  // Initialize StreamingAudioPlayer after component mounts
  useEffect(() => {
    if (typeof window !== 'undefined' && !streamingPlayerRef.current) {
      streamingPlayerRef.current = new StreamingAudioPlayer(
        () => {
          console.log("🔊 Streaming audio completed");
          if (status === "speaking") {
            setStatus("idle");
          }
        },
        // Segment callbacks for text-audio synchronization
        {
          onSegmentStart: (segment) => {
            console.log(`📝 ✅ Text segment started: "${segment.text.substring(0, 30)}..."`);
            setCurrentPlayingSegment(segment.id);
            
            // Update UI to highlight current segment
            setMessages(prev => 
              prev.map((msg, index) => 
                index === prev.length - 1 && msg.role === "assistant" 
                  ? { ...msg, content: msg.content, currentSegment: segment.id }
                  : msg
              )
            );
          },
          onChunkPlayed: (segment, chunkIndex, textPortion) => {
            console.log(`📝 Chunk ${chunkIndex + 1} played - displaying: "${textPortion}"`);
            
            // Append text as each audio chunk plays
            setMessages(prev => {
              const lastMsg = prev[prev.length - 1];
              if (lastMsg && lastMsg.role === "assistant") {
                const separator = lastMsg.content && !lastMsg.content.endsWith(' ') ? ' ' : '';
                const updatedContent = lastMsg.content + separator + textPortion;
                return prev.slice(0, -1).concat({ ...lastMsg, content: updatedContent });
              }
              return prev;
            });
          },
          onSegmentEnd: (segment) => {
            console.log(`📝 ✅ Text segment completed: "${segment.text.substring(0, 30)}..."`);
            setCurrentPlayingSegment(null);
          },
          onTextDisplay: (segment, progress) => {
            console.log(`📝 📊 Text progress: ${(progress * 100).toFixed(1)}% for "${segment.text.substring(0, 20)}..."`);
            
            // Update UI with progress - could be used for typewriter effect, highlighting, etc.
            // This gives you precise control over text display timing
          },
          onQueueEmpty: () => {
            console.log('🏁 All TTS segments completed - re-enabling listening');
            
            // 🎤 RE-ENABLE LISTENING: All TTS playback complete
            setIsTTSPlaying(false);
            setStatus("idle");
            
            // Wait a brief moment for audio to fully finish, then re-enable VAD
            setTimeout(() => {
              if (vadInstance && vadReady) {
                vadInstance.start();
                setIsListening(true);
                isListeningRef.current = true;
                console.log("🎤 Listening re-enabled - ready for next input");
              }
            }, 500); // Short delay to ensure audio context is settled
          }
        }
      );
      
      // Ensure AudioContext is properly initialized
      streamingPlayerRef.current.initializeAudioContext();
      console.log("🔊 StreamingAudioPlayer initialized after mount");
    }
  }, []);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isListeningRef = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);
  const ttsCancelledRef = useRef<boolean>(false);
  const streamingCancelledRef = useRef<boolean>(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const lastSpeechStartRef = useRef<number | null>(null);
  const interruptionTimestampsRef = useRef<number[]>([]);
  const segmentCounterRef = useRef(0);
  const currentResponseSegmentIds = useRef<Set<string>>(new Set());

  // Configure VAD settings based on mode
  const getVADConfig = useCallback(() => {
    const frameMs = 32;
    const presetConfig = {
      ultra: {
        redemptionFrames: 8,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        preSpeechPadFrames: 18,
      },
      fast: {
        redemptionFrames: 11,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        preSpeechPadFrames: 20,
      },
      balanced: {
        redemptionFrames: 20,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        preSpeechPadFrames: 25,
      },
      reliable: {
        redemptionFrames: 31,
        positiveSpeechThreshold: 0.55,
        negativeSpeechThreshold: 0.35,
        preSpeechPadFrames: 30,
      }
    } as const;
    
    const effectiveMode = vadMode === 'adaptive' ? adaptiveEffectiveMode : vadMode;
    return presetConfig[effectiveMode];
  }, [vadMode, adaptiveEffectiveMode]);

  // Load gRPC capabilities on mount
  useEffect(() => {
    const loadCapabilities = async () => {
      try {
        const capabilities = await grpcSTTService.getCapabilities();
        setGrpcCapabilities(capabilities);
        console.log('📋 gRPC STT Capabilities:', capabilities);
      } catch (error) {
        console.error('Failed to load gRPC capabilities:', error);
      }
    };
    
    loadCapabilities();
  }, []);

  // Initialize VAD using direct API
  useEffect(() => {
    let isInitializing = false;
    
    const initVAD = async () => {
      if (isInitializing || vadInstance) {
        console.log("🔄 VAD already initializing or initialized, skipping...");
        return;
      }
      
      isInitializing = true;
      
      try {
        console.log("🔄 Initializing VAD with direct API for gRPC STT...");
        setVadLoading(true);
        setVadError(null);
        
        // Wait for VAD library to be fully loaded (reduced since WASM is working)
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check for VAD availability with detailed logging
        console.log("🔍 Checking VAD availability...");
        console.log("🔍 Window object:", typeof window);
        console.log("🔍 window.vad:", window.vad);
        console.log("🔍 window.vad keys:", window.vad ? Object.keys(window.vad) : 'N/A');
        
        if (typeof window === 'undefined' || !window.vad) {
          console.error("❌ VAD not available. Scripts may not have loaded properly.");
          setVadError("VAD library not found - click Retry or refresh the page");
          setVadLoading(false);
          isInitializing = false;
          return;
        }
        
        if (!window.vad.MicVAD) {
          console.error("❌ MicVAD not available in VAD library");
          setVadError("MicVAD not found in VAD library - click Retry");
          setVadLoading(false);
          isInitializing = false;
          return;
        }
        
        console.log("✅ VAD library found with MicVAD:", !!window.vad.MicVAD);

        // Use the exact same options structure as the working VoiceAssistant
        const vadOptions = {
          onSpeechStart: () => {
            console.log("🎤 VAD: Speech detected!", { isListening: isListeningRef.current });
            
            // Strict check: Only process if we're actively listening
            if (!isListeningRef.current) {
              console.log("🚫 Speech detected but not listening - ignoring");
              return;
            }
            
            console.log("✅ Speech detected - recording started");
            setStatus("recording");
          },
          onSpeechEnd: async (audio: Float32Array) => {
            console.log("🔇 VAD: Speech ended!", { 
              isListening: isListeningRef.current, 
              audioLength: audio.length,
              audioSample: audio.slice(0, 10),
              noiseCancellation: noiseCancellationEnabled
            });
            
            if (!isListeningRef.current) {
              console.log("Speech ended but not listening - ignoring");
              return;
            }
            
            // 🔇 STOP LISTENING IMMEDIATELY: Set flag first to prevent race conditions
            // This prevents VAD from triggering again while we process this audio
            isListeningRef.current = false;
            setIsListening(false);
            
            console.log("Processing speech with real-time gRPC STT streaming");
            setStatus("transcribing");
            
            // Pause VAD to stop microphone capture
            if (vadInstance) {
              console.log("🔇 Pausing VAD for transcription processing");
              vadInstance.pause();
            }

            // Validate audio data
            if (!audio || audio.length === 0) {
              console.error("❌ Invalid audio data - empty or null");
              setStatus("idle");
              return;
            }
            
            // Apply noise cancellation processing if enabled
            let processedAudio = audio;
            if (noiseCancellationEnabled && noiseProcessorRef.current) {
              console.log("🔧 Applying noise cancellation to audio...");
              const startTime = performance.now();
              processedAudio = noiseProcessorRef.current.processAudioData(audio);
              const processingTime = performance.now() - startTime;
              console.log(`✅ Noise cancellation applied in ${processingTime.toFixed(2)}ms`);
              
              // Update noise statistics
              const analysisData = noiseProcessorRef.current.getAnalysisData();
              setNoiseStats({
                noiseFloor: analysisData.noiseFloor,
                currentLevel: analysisData.currentLevel,
                processingLatency: analysisData.processingLatency,
                enabled: noiseCancellationEnabled
              });
            }
            
            try {
              const transcriptionStartTime = Date.now();
              console.log(`🎯 Starting real-time gRPC transcription with model: ${grpcModel}`);
              
              // Real-time streaming approach: send processed audio in chunks
              await streamAudioInRealTime(processedAudio, transcriptionStartTime);
              
            } catch (error) {
              console.error("❌ Real-time transcription error:", error);
              setStatus("idle");
            }
          },
          ...getVADConfig(),
          
          // Enhanced audio stream with noise cancellation
          getStream: async () => {
            console.log("🎤 Creating enhanced audio stream with noise cancellation level:", noiseCancellationLevel);
            return await getEnhancedAudioStream(noiseCancellationLevel);
          },
          
          resumeStream: async () => {
            console.log("🎤 Resuming enhanced audio stream with noise cancellation level:", noiseCancellationLevel);
            return await getEnhancedAudioStream(noiseCancellationLevel);
          }
        };

        console.log("� Creating VAD instance with options:", vadOptions);
        console.log("🔧 VAD MicVAD available:", !!window.vad.MicVAD);
        
        // Add timeout to prevent hanging
        const vadInstPromise = window.vad.MicVAD.new(vadOptions);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('VAD initialization timeout')), 10000)
        );
        
        const vadInst = await Promise.race([vadInstPromise, timeoutPromise]);
        console.log("🔧 VAD instance created:", vadInst);
        
        // Initialize noise cancellation processor if enabled
        if (noiseCancellationEnabled && !noiseProcessorRef.current) {
          try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            console.log("🔧 Initializing noise cancellation processor...");
            noiseProcessorRef.current = new NoiseReductionProcessor(audioContext, {
              preset: noiseCancellationLevel,
              enabled: noiseCancellationEnabled
            });
            console.log("✅ Noise cancellation processor initialized");
            
            // Update noise stats
            const stats = noiseProcessorRef.current.getStats();
            setNoiseStats(prev => ({
              ...prev,
              enabled: stats.enabled,
              noiseFloor: stats.noiseFloor
            }));
          } catch (error) {
            console.warn("⚠️ Failed to initialize noise cancellation processor:", error);
          }
        }
        
        // Stop the VAD initially - we'll start when user clicks button
        await vadInst.pause();
        console.log("🔧 VAD paused, waiting for user to start");
        
        setVadInstance(vadInst);
        setVadReady(true);
        setIsVadReady(true);
        setVadError(null);
        setVadLoading(false);
        console.log("✅ VAD initialized successfully for gRPC STT with noise cancellation");
        
      } catch (error) {
        console.error("❌ Failed to initialize VAD:", error);
        setVadError(`Failed to initialize VAD: ${error}`);
        setVadLoading(false);
      } finally {
        isInitializing = false;
      }
    };

    if (typeof window !== 'undefined') {
      initVAD();
      
      // Fallback: If VAD library is available but initialization is stuck
      setTimeout(() => {
        if (vadLoading && typeof window !== 'undefined' && window.vad && window.vad.MicVAD) {
          console.log("🔄 VAD library detected but initialization stuck, forcing ready state");
          setVadLoading(false);
          setVadReady(true);
          setVadError(null);
        }
      }, 5000);
    }

    return () => {
      if (vadInstance) {
        console.log("🔄 Cleaning up VAD instance");
        try {
          vadInstance.destroy?.();
        } catch (e) {
          console.warn("Warning during VAD cleanup:", e);
        }
      }
      
      // Cleanup noise cancellation processor
      if (noiseProcessorRef.current) {
        console.log("🔄 Cleaning up noise cancellation processor");
        try {
          noiseProcessorRef.current.dispose();
          noiseProcessorRef.current = null;
        } catch (e) {
          console.warn("Warning during noise processor cleanup:", e);
        }
      }
    };
  }, [vadMode, adaptiveEffectiveMode, language, grpcModel, noiseCancellationEnabled, noiseCancellationLevel]);

  // Function to update noise cancellation settings
  const updateNoiseCancellation = useCallback((enabled: boolean, level?: 'light' | 'balanced' | 'aggressive') => {
    setNoiseCancellationEnabled(enabled);
    if (level) {
      setNoiseCancellationLevel(level);
    }
    
    // Update existing processor if available
    if (noiseProcessorRef.current) {
      if (level) {
        noiseProcessorRef.current.setPreset(level);
      }
      noiseProcessorRef.current.updateOptions({ enabled });
      
      const stats = noiseProcessorRef.current.getStats();
      setNoiseStats(prev => ({
        ...prev,
        enabled: stats.enabled
      }));
    }
    
    console.log("🔧 Noise cancellation updated:", { enabled, level });
  }, []);

  // Function to get current noise cancellation stats
  const getNoiseCancellationStats = useCallback(() => {
    if (noiseProcessorRef.current) {
      const analysisData = noiseProcessorRef.current.getAnalysisData();
      setNoiseStats({
        noiseFloor: analysisData.noiseFloor,
        currentLevel: analysisData.currentLevel,
        processingLatency: analysisData.processingLatency,
        enabled: noiseCancellationEnabled
      });
    }
    return noiseStats;
  }, [noiseCancellationEnabled, noiseStats]);

  // Periodic update of noise cancellation stats
  useEffect(() => {
    if (!noiseCancellationEnabled || !noiseProcessorRef.current) return;
    
    const interval = setInterval(() => {
      getNoiseCancellationStats();
    }, 1000); // Update every second
    
    return () => clearInterval(interval);
  }, [noiseCancellationEnabled, getNoiseCancellationStats]);

  // Generate AI response using the same LLM service
  const generateResponse = async (conversationMessages: Message[], targetSessionId?: string) => {
    const effectiveSessionId = targetSessionId || sessionId;
    console.log("🚀 DEBUG: generateResponse called with:", conversationMessages);
    console.log("🔑 DEBUG: Session ID check (effective):", effectiveSessionId);
    console.log("🔑 DEBUG: Session ID check (state):", sessionId);
    
    if (!effectiveSessionId) {
      console.error("❌ DEBUG: No session ID available for LLM call");
      return;
    }
    
    // Note: Listening is already stopped at STT stage (onSpeechEnd)
    // No need to stop it again here
    
    try {
      console.log("🔄 DEBUG: Setting up streaming...");
      
      // Clear previous response's segments before starting new response
      if (currentResponseSegmentIds.current.size > 0 && streamingPlayerRef.current) {
        console.log(`🧹 Clearing ${currentResponseSegmentIds.current.size} segments from previous response`);
        streamingPlayerRef.current.clearSegmentsByIds(currentResponseSegmentIds.current);
        currentResponseSegmentIds.current.clear();
      }
      
      // Reset cancellation flags for new response generation
      streamingCancelledRef.current = false;
      ttsCancelledRef.current = false;
      console.log("🔄 DEBUG: Reset both streaming and TTS cancellation flags");
      
      // Ensure streaming player is ready for new content
      if (streamingPlayerRef.current) {
        streamingPlayerRef.current.resume();
        console.log("🔄 DEBUG: Streaming player resumed for new response");
      }
      
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      const apiMessages: ApiMessage[] = conversationMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      console.log("📝 DEBUG: API messages:", apiMessages);

      // Add temporary assistant message (text will be populated as TTS audio arrives)
      const tempMessage: Message = { role: "assistant", content: "" };
      setMessages(prev => [...prev, tempMessage]);

      // Text-Audio Synchronization Strategy:
      // 1. LLM streams text chunks → accumulate in pendingText
      // 2. When complete sentence detected → send to TTS
      // 3. TTS sends audio chunks → display text on FIRST chunk, start playback
      // 4. Result: Text and audio appear together, perfectly synchronized
      
      let fullResponse = "";
      let pendingText = "";
      let hasStartedSpeaking = false;
      
      console.log("🌊 DEBUG: Calling generateChatStream...");
      const streamReader = await generateChatStream(apiMessages, effectiveSessionId);
      console.log("✅ DEBUG: generateChatStream returned, starting to read chunks...");
      
      let chunkCount = 0;
      for await (const chunk of streamReader) {
        chunkCount++;
        console.log(`📦 DEBUG: Processing chunk ${chunkCount}:`, chunk);
        
        if (streamingCancelledRef.current) {
          console.log("⚠️ DEBUG: Streaming was cancelled");
          break;
        }
        
        if (chunk.text) {
          console.log(`✏️ DEBUG: Chunk ${chunkCount} text:`, chunk.text);
          fullResponse += chunk.text;
          pendingText += chunk.text;
          
          console.log(`📊 DEBUG: Full response so far: "${fullResponse}"`);
          console.log(`📊 DEBUG: Pending text: "${pendingText}"`);
          
          // DON'T update UI here - text will display when TTS audio chunks arrive
          // This ensures perfect text-audio synchronization
          
          // Strategy: Send complete sentences to TTS for natural speech
          // This balances latency (quick feedback) with quality (natural pacing)
          
          // Clean pending text first to handle partial markdown
          const cleanedPending = pendingText
            .replace(/\*\*[^*]*$/, '') // Remove incomplete bold formatting
            .replace(/\*[^*]*$/, '')   // Remove incomplete italic formatting
            .replace(/`[^`]*$/, '')    // Remove incomplete code formatting
            .replace(/```[^`]*$/, ''); // Remove incomplete code blocks
          
          // Enhanced sentence boundary detection
          // Matches: period, exclamation, question mark (with optional quotes/parentheses)
          const sentenceEndPattern = /[.!?]+[\]"')]*(?:\s|$)/g;
          const matches = [...cleanedPending.matchAll(sentenceEndPattern)];
          
          if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            const endIndex = lastMatch.index! + lastMatch[0].length;
            const completeSentences = cleanedPending.substring(0, endIndex).trim();
            
            // Minimum 15 chars to avoid sending tiny fragments like "Hi." 
            // Maximum 500 chars per segment for better chunking of long sentences
            if (completeSentences && completeSentences.length >= 15 && completeSentences.length <= 500) {
              if (!hasStartedSpeaking) {
                setStatus("speaking");
                hasStartedSpeaking = true;
                setIsTTSPlaying(true);
              }
              
              // Send to TTS - text will display when first audio chunk arrives
              console.log(`🎭 Sending to TTS: "${completeSentences.substring(0, 50)}..." (${completeSentences.length} chars)`);
              await createSynchronizedSegment(completeSentences);
              
              // Remove the sent text from pendingText by using the exact end position from cleanedPending
              // Since cleanedPending is derived from pendingText, we use the same end position
              pendingText = pendingText.substring(endIndex).trim();
              console.log(`📊 DEBUG: Remaining pending text after send: "${pendingText}"`);
            } else if (completeSentences.length > 500) {
              // If sentence is too long, split at comma or semicolon for better chunking
              const subChunkPattern = /[,;]+(?:\s|$)/g;
              const subMatches = [...completeSentences.matchAll(subChunkPattern)];
              
              if (subMatches.length > 0) {
                const subEndIndex = subMatches[0].index! + subMatches[0][0].length;
                const subChunk = completeSentences.substring(0, subEndIndex).trim();
                
                if (subChunk.length >= 15) {
                  if (!hasStartedSpeaking) {
                    setStatus("speaking");
                    hasStartedSpeaking = true;
                    setIsTTSPlaying(true);
                  }
                  
                  console.log(`🎭 Sending sub-chunk to TTS: "${subChunk.substring(0, 50)}..." (${subChunk.length} chars)`);
                  await createSynchronizedSegment(subChunk);
                  
                  // Remove the sent sub-chunk from pendingText using position-based logic
                  pendingText = pendingText.substring(subEndIndex).trim();
                  console.log(`📊 DEBUG: Remaining pending text after sub-chunk: "${pendingText}"`);
                }
              }
            }
          }
        }
      }

      console.log(`🏁 DEBUG: Stream processing completed. Total chunks: ${chunkCount}`);
      console.log(`🏁 DEBUG: Final full response: "${fullResponse}"`);
      console.log(`🏁 DEBUG: Final pending text: "${pendingText}"`);

      // Send any remaining text to TTS
      if (!streamingCancelledRef.current && pendingText.trim()) {
        console.log("🔊 DEBUG: Processing remaining text for TTS:", pendingText.trim());
        if (!hasStartedSpeaking) {
          console.log("🔊 DEBUG: Setting status to speaking for remaining text");
          setStatus("speaking");
          setIsTTSPlaying(true);
        }
        await streamTextToTTS(pendingText.trim());
      } else {
        console.log("🔇 DEBUG: No remaining text for TTS");
      }
      
      console.log("✅ DEBUG: generateResponse completed successfully");
      console.log("⏳ Waiting for all TTS segments to complete (onQueueEmpty will re-enable listening)");
      
      // Note: Listening will be re-enabled automatically by onQueueEmpty callback
      // when all TTS segments have finished playing
      
    } catch (error) {
      if (!streamingCancelledRef.current) {
        console.error("❌ DEBUG: Error generating response:", error);
        console.error("❌ DEBUG: Error type:", typeof error);
        console.error("❌ DEBUG: Error message:", error instanceof Error ? error.message : String(error));
        console.error("❌ DEBUG: Error stack:", error instanceof Error ? error.stack : 'No stack trace');
        setStatus("idle");
      } else {
        console.log("⚠️ DEBUG: Error during streaming (cancelled):", error);
      }
      
      // Re-enable listening even on error
      setIsTTSPlaying(false);
      if (vadInstance && vadReady) {
        vadInstance.start();
        setIsListening(true);
        isListeningRef.current = true;
        console.log("🎤 Listening re-enabled after error");
      }
    }
  };

  // Create a synchronized segment for text-audio playback
  const createSynchronizedSegment = async (text: string) => {
    try {
      console.log(`🎭 Creating synchronized segment for: "${text}"`);
      console.log(`🎭 DEBUG: Flag states - ttsCancelled: ${ttsCancelledRef.current}, streamingCancelled: ${streamingCancelledRef.current}`);
      
      // Check if StreamingAudioPlayer is available
      if (!streamingPlayerRef.current) {
        console.warn("🔊 StreamingAudioPlayer not available, cannot create segment");
        return;
      }

      // Ensure TTS cancelled flag is still false
      ttsCancelledRef.current = false;
      console.log(`🎵 DEBUG: TTS cancelled flag reset to false`);
      
      const sanitizedText = sanitizeForTTS(text);
      console.log(`🎙️ DEBUG: Original text: "${text}"`);
      console.log(`🎙️ DEBUG: Sanitized text: "${sanitizedText}"`);
      console.log(`🎙️ DEBUG: Sanitized text length: ${sanitizedText.length}`);
      
      if (!sanitizedText.trim()) {
        console.log("🎙️ DEBUG: Sanitized text is empty, skipping segment creation");
        return;
      }
      
      // Create a segment for synchronized text-audio playback
      const segmentId = `segment-${Date.now()}-${segmentCounterRef.current++}`;
      
      // Track this segment ID for the current response
      currentResponseSegmentIds.current.add(segmentId);
      console.log(`📋 Tracking segment "${segmentId}" (Total: ${currentResponseSegmentIds.current.size})`);
      
      const textSegment = streamingPlayerRef.current.createTextSegment(segmentId, sanitizedText);
      console.log(`📝 Created synchronized segment "${segmentId}" for: "${sanitizedText}"`);

      // DON'T set current playing segment yet - wait for first audio chunk
      // setCurrentPlayingSegment(segmentId);
      
      console.log(`🎙️ Streaming to gRPC TTS for segment: "${sanitizedText}"`);
      console.log(`🎙️ DEBUG: About to call grpcTTSService.streamingSynthesize...`);
      console.log(`🎙️ DEBUG: grpcTTSService available:`, !!grpcTTSService);
      console.log(`🎙️ DEBUG: ttsCancelledRef.current:`, ttsCancelledRef.current);
      
      // Stream TTS for this specific segment
      console.log(`🎙️ DEBUG: Calling streamingSynthesize now...`);
      
      let isFirstChunk = true;
      
      await grpcTTSService.streamingSynthesize(
        sanitizedText,
        {
          voice: 'en_US-lessac-medium',
          speed: 1.0
        },
        // onChunk callback - add audio chunks to this segment
        async (chunk) => {
          console.log(`🎵 TTS chunk received for segment "${segmentId}", ttsCancelledRef.current: ${ttsCancelledRef.current}`);
          
          if (ttsCancelledRef.current) {
            console.log("🚫 TTS chunk cancelled for segment:", segmentId);
            return;
          }

          console.log(`🎵 TTS chunk for segment "${segmentId}":`, {
            audioDataLength: chunk.audioData.length,
            isFinal: chunk.isFinal,
            timestamp: chunk.timestamp,
            firstBytes: Array.from(chunk.audioData.slice(0, 10))
          });

          if (streamingPlayerRef.current && chunk.audioData.length > 0) {
            console.log(`🎵 Adding audio chunk to segment "${segmentId}" - Size: ${chunk.audioData.length} bytes`);
            await streamingPlayerRef.current.addAudioToSegment(segmentId, chunk.audioData);
            
            // Get current segment info for debugging
            const segment = streamingPlayerRef.current.getSegment(segmentId);
            console.log(`📊 Segment "${segmentId}" now has ${segment?.audioChunks.length} total chunks`);
            
            // ⚡ On FIRST chunk, mark segment ready for audio playback
            // Text will be displayed automatically as each audio chunk plays via onChunkPlayed callback
            if (isFirstChunk) {
              console.log(`🎬 First chunk received for "${segmentId}" - starting audio playback`);
              console.log(`🎬 Chunk 1 size: ${chunk.audioData.length} bytes`);
              
              // Mark segment ready for audio playback
              streamingPlayerRef.current.completeSegment(segmentId);
              setCurrentPlayingSegment(segmentId);
              isFirstChunk = false;
            }
          } else {
            console.log(`🎵 Empty audio chunk, skipping...`);
          }
        },
        // onComplete callback - mark audio streaming as complete
        () => {
          console.log(`✅ TTS completed for segment: "${sanitizedText.substring(0, 50)}..."`);
          console.log(`🏁 All audio chunks delivered for segment "${segmentId}"`);
          if (streamingPlayerRef.current) {
            streamingPlayerRef.current.markSegmentAudioComplete(segmentId);
          }
        },
        // onError callback
        (error) => {
          console.error("❌ gRPC TTS streaming error for segment:", error);
          setCurrentPlayingSegment(null);
        }
      );
      
      console.log(`✅ TTS streaming completed for segment: "${segmentId}"`);
      
    } catch (error) {
      console.error("❌ Error creating synchronized segment:", error);
      console.error("❌ Error details:", error);
      setCurrentPlayingSegment(null);
    }

  };

  // Speak response using TTS
  // Stream text chunks to TTS as they arrive from LLM
  const streamTextToTTS = async (text: string) => {
    console.log("🎙️ DEBUG: streamTextToTTS delegating to createSynchronizedSegment");
    await createSynchronizedSegment(text);
  };

  const speakResponse = async (text: string) => {
    try {
      ttsCancelledRef.current = false;
      await streamTextToTTS(text);
      
      if (!ttsCancelledRef.current) {
        setStatus("idle");
      }
    } catch (error) {
      console.error("❌ gRPC TTS error:", error);
      setStatus("idle");
    }
  };

  // Process audio with single transcription call (most reliable)
  const streamAudioInRealTime = async (audio: Float32Array, transcriptionStartTime: number) => {
    // Convert to WAV format
    const wavBlob = float32ToWav(audio, 16000);
    
    console.log("🎯 DEBUG: Starting single transcription");
    console.log("🎯 DEBUG: WAV blob size:", wavBlob.size);
    
    try {
      // Use single transcription call (more reliable than streaming for complete WAV files)
      const result = await grpcSTTService.transcribe(wavBlob, {
        model: grpcModel,
        language: language,
        wordTimestamps: true,
      });
      
      const transcriptionEndTime = Date.now();
      const duration = transcriptionEndTime - transcriptionStartTime;
      console.log(`🎯 DEBUG: Single transcription completed in ${duration}ms`);
      console.log(`🎯 DEBUG: Result:`, result);
      
      // Clear any partial transcription
      setPartialTranscription('');
      
      if (result.success && result.text.trim()) {
        const transcription = result.text.trim();
        console.log("🚀 DEBUG: About to call processTranscriptionAndStartLLM with:", transcription);
        processTranscriptionAndStartLLM(transcription);
      } else {
        console.log("❌ DEBUG: No successful transcription result");
        console.log("❌ DEBUG: Result success:", result.success);
        console.log("❌ DEBUG: Result text:", result.text);
        console.log("❌ DEBUG: Result error:", result.errorMessage);
        setStatus("idle");
      }
      
    } catch (error) {
      console.error("❌ DEBUG: Single transcription error:", error);
      setStatus("idle");
    }
  };

  // Process transcription and start LLM immediately
  const processTranscriptionAndStartLLM = async (transcription: string) => {
    console.log("🚀 DEBUG: processTranscriptionAndStartLLM called with:", transcription);
    console.log("🚀 DEBUG: Current session ID:", sessionId);
    console.log("🚀 DEBUG: Current messages:", messages);
    
    // Add user message to conversation
    const newUserMessage: Message = { role: "user", content: transcription };
    setMessages(prev => {
      console.log("🚀 DEBUG: Adding message to conversation:", newUserMessage);
      return [...prev, newUserMessage];
    });

    // Start LLM response generation immediately
    console.log("🚀 DEBUG: Setting status to thinking");
    setStatus("thinking");
    
    // Wait for session and generate response
    const waitForSessionAndGenerate = async () => {
      console.log("🚀 DEBUG: waitForSessionAndGenerate started");
      let currentSessionId = sessionId;
      let attempts = 0;
      const maxAttempts = 5; // Reduced attempts
      
      while (!currentSessionId && attempts < maxAttempts) {
        console.log(`⏳ DEBUG: Waiting for session... (attempt ${attempts + 1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 100)); // Shorter wait
        currentSessionId = sessionId;
        attempts++;
      }
      
      if (currentSessionId) {
        console.log("✅ DEBUG: Session ready, calling generateResponse");
        console.log("✅ DEBUG: Messages to send:", [...messages, newUserMessage]);
        await generateResponse([...messages, newUserMessage], currentSessionId);
      } else {
        console.error("❌ DEBUG: Session not available after waiting, trying to create new session");
        // Try to create a new session immediately
        try {
          const newSessionId = await createSession();
          console.log("✅ DEBUG: Created new session on demand:", newSessionId);
          setSessionId(newSessionId);
          // Pass the newly created session ID directly to generateResponse
          await generateResponse([...messages, newUserMessage], newSessionId);
        } catch (error) {
          console.error("❌ DEBUG: Failed to create session on demand:", error);
          setStatus("idle");
        }
      }
    };
    
    waitForSessionAndGenerate().catch(error => {
      console.error("❌ DEBUG: Response generation error:", error);
      setStatus("idle");
    });
  };

  // Stop current TTS/streaming without stopping listening mode
  const stopCurrentPlayback = useCallback(() => {
    console.log("🛑 Stopping current playback but keeping listening active...");
    
    // Stop current audio playback
    audioQueueRef.current.stop();
    
    // Clear current response segments if any exist
    if (streamingPlayerRef.current && currentResponseSegmentIds.current.size > 0) {
      console.log(`🧹 Clearing ${currentResponseSegmentIds.current.size} segments from current playback`);
      streamingPlayerRef.current.clearSegmentsByIds(currentResponseSegmentIds.current);
      currentResponseSegmentIds.current.clear();
    }
    
    // Cancel current TTS/streaming
    ttsCancelledRef.current = true;
    streamingCancelledRef.current = true;
    console.log("🎙️ DEBUG: TTS cancelled - ready for next input");
    
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }
    
    // Keep listening mode active for next input
    setStatus("idle");
  }, []);

  // Toggle listening state  
  const toggleListening = useCallback(async () => {
    if (!vadReady || !vadInstance) {
      console.log("❌ VAD not ready");
      return;
    }

    if (isTTSPlaying) {
      console.log("🔇 TTS is playing - microphone disabled in debugging mode");
      return;
    }

    try {
      if (isListening) {
        console.log("🔇 Stopping listening...");
        
        // Stop current playback first
        stopCurrentPlayback();
        
        // Then stop listening
        vadInstance.pause();
        setIsListening(false);
        isListeningRef.current = false;
        setStatus("idle");
      } else {
        console.log("� Starting listening...");
        
        // Stop any current audio playback when starting fresh
        stopCurrentPlayback();

        vadInstance.start();
        setIsListening(true);
        isListeningRef.current = true;
        setStatus("idle");
      }
    } catch (error) {
      console.error("❌ Error toggling listening:", error);
      setStatus("idle");
    }
  }, [isListening, isTTSPlaying, vadReady, vadInstance, stopCurrentPlayback]);

  // Initialize session
  useEffect(() => {
    const initSession = async () => {
      try {
        console.log("🔄 DEBUG: Attempting to create session...");
        const newSessionId = await createSession();
        console.log("✅ DEBUG: Session creation returned:", newSessionId);
        setSessionId(newSessionId);
        console.log("✅ gRPC Voice Assistant session created:", newSessionId);
      } catch (error) {
        console.error("❌ DEBUG: Failed to create session:", error);
        console.error("❌ DEBUG: Session creation error details:", error);
      }
    };

    initSession();
    setIsMounted(true);

    return () => {
      if (sessionId) {
        deleteSession(sessionId).catch(console.error);
      }
    };
  }, []);

  // Clear conversation
  const clearConversation = useCallback(() => {
    setMessages([]);
    audioQueueRef.current.stop();
    if (streamingPlayerRef.current) {
      streamingPlayerRef.current.stop();
    }
    ttsCancelledRef.current = true;
    streamingCancelledRef.current = true;
    console.log("🎙️ DEBUG: TTS cancelled due to clear conversation");
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }
    setStatus("idle");
  }, []);

  // Stop audio playback
  const handleUserStopAudio = useCallback(() => {
    audioQueueRef.current.stop();
    if (streamingPlayerRef.current) {
      streamingPlayerRef.current.stop();
    }
    ttsCancelledRef.current = true;
    streamingCancelledRef.current = true;
    console.log("🎙️ DEBUG: TTS cancelled due to user stop audio");
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }
    setStatus("idle");
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!isMounted) {
    return <div className="flex items-center justify-center h-screen bg-black text-white">Loading gRPC Voice Assistant...</div>;
  }

  return (
    <div className="h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white overflow-hidden">
      {/* Header */}
      <div className="bg-black/30 backdrop-blur-sm border-b border-white/10 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
            🎯 gRPC Voice Assistant
          </h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-300">gRPC STT:</span>
              <div className={`w-3 h-3 rounded-full ${useGrpcSTT ? 'bg-green-400' : 'bg-red-400'}`}></div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-300">Model:</span>
              <select
                value={grpcModel}
                onChange={(e) => setGrpcModel(e.target.value)}
                className="bg-black/50 border border-white/20 rounded px-2 py-1 text-sm"
              >
                <option value="distil-large-v2">distil-large-v2</option>
                <option value="large-v3">large-v3</option>
                <option value="base">base</option>
                <option value="small">small</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-300">Language:</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="bg-black/50 border border-white/20 rounded px-2 py-1 text-sm"
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="it">Italian</option>
                <option value="pt">Portuguese</option>
                <option value="ru">Russian</option>
                <option value="ja">Japanese</option>
                <option value="ko">Korean</option>
                <option value="zh">Chinese</option>
              </select>
            </div>
            
            {/* Noise Cancellation Controls */}
            <div className="flex items-center gap-2 ml-4 pl-4 border-l border-white/20">
              <span className="text-sm text-gray-300">Noise Reduction:</span>
              <button
                onClick={() => updateNoiseCancellation(!noiseCancellationEnabled, noiseCancellationLevel)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  noiseCancellationEnabled 
                    ? 'bg-green-500/20 border border-green-400 text-green-400' 
                    : 'bg-gray-500/20 border border-gray-500 text-gray-400'
                }`}
              >
                {noiseCancellationEnabled ? '🔇 ON' : '🔊 OFF'}
              </button>
              {noiseCancellationEnabled && (
                <select
                  value={noiseCancellationLevel}
                  onChange={(e) => updateNoiseCancellation(true, e.target.value as 'light' | 'balanced' | 'aggressive')}
                  className="bg-black/50 border border-white/20 rounded px-2 py-1 text-xs"
                >
                  <option value="light">Light</option>
                  <option value="balanced">Balanced</option>
                  <option value="aggressive">Aggressive</option>
                </select>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-80px)]">
        {/* Left Side - Voice Controls */}
        <div className="flex flex-col items-center justify-center bg-black/20 backdrop-blur-sm p-8 min-w-96">
          <div className="text-center space-y-6">
            {/* Status Display */}
            <div className="mb-8">
              <div className={`text-lg font-semibold mb-2 ${
                status === "idle" ? "text-gray-300" :
                status === "recording" ? "text-red-400" :
                status === "transcribing" ? "text-yellow-400" :
                status === "thinking" ? "text-blue-400" :
                "text-green-400"
              }`}>
                {status === "idle" && !isTTSPlaying && "Ready to listen"}
                {status === "idle" && isTTSPlaying && "🔇 Microphone disabled during TTS"}
                {status === "recording" && "🎤 Recording..."}
                {status === "transcribing" && `🔄 Processing with ${grpcModel}...`}
                {status === "processing" && "⚡ Processing audio..."}
                {status === "thinking" && "🤔 Thinking..."}
                {status === "speaking" && "🔊 Speaking... (mic disabled)"}
              </div>
              
              {/* Segment Playback Indicator */}
              {currentPlayingSegment && (
                <div className="text-sm text-purple-400 animate-pulse">
                  🎭 Playing segment: {currentPlayingSegment}
                </div>
              )}
              

            </div>

            {/* Main Voice Button */}
            <div className="relative">
              <button
                onClick={toggleListening}
                disabled={!vadReady || isTTSPlaying}
                className={`
                  relative w-32 h-32 rounded-full border-4 transition-all duration-300 transform
                  ${isTTSPlaying
                    ? "border-orange-400 bg-orange-500/20 opacity-75 cursor-not-allowed"
                    : isListening 
                      ? "border-red-400 bg-red-500/20 scale-110 shadow-lg shadow-red-500/50" 
                      : "border-blue-400 bg-blue-500/20 hover:scale-105 hover:shadow-lg hover:shadow-blue-500/50"
                  }
                  ${!vadReady ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
                `}
              >
                {/* Microphone Icon */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg
                    className={`w-12 h-12 ${isListening ? "text-red-400" : "text-blue-400"}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path 
                      fillRule="evenodd" 
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" 
                      clipRule="evenodd" 
                    />
                  </svg>
                </div>

                {/* Recording Animation */}
                {status === "recording" && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="absolute w-full h-full">
                      <div className="wave-bar-1 absolute bg-red-400 rounded-full w-1"></div>
                      <div className="wave-bar-2 absolute bg-red-400 rounded-full w-1"></div>
                      <div className="wave-bar-3 absolute bg-red-400 rounded-full w-1"></div>
                      <div className="wave-bar-4 absolute bg-red-400 rounded-full w-1"></div>
                      <div className="wave-bar-5 absolute bg-red-400 rounded-full w-1"></div>
                    </div>
                  </div>
                )}

                {/* Pulse Animation for Listening */}
                {isListening && status === "idle" && (
                  <div className="absolute inset-0 rounded-full bg-blue-400/20 animate-pulse"></div>
                )}
              </button>

              {/* Capability Status */}
              <div className="mt-4 text-center">
                <div className="text-xs text-gray-400">
                  VAD: {vadReady ? "✅ Ready" : "⏳ Loading..."}
                </div>
                <div className="text-xs text-gray-400">
                  gRPC: {grpcCapabilities ? "✅ Connected" : "⏳ Connecting..."}
                </div>
                
                {/* Noise Cancellation Status */}
                <div className="text-xs text-gray-400 mt-1">
                  Noise Cancellation: {noiseStats.enabled ? (
                    <span className="text-green-400">
                      ✅ {noiseCancellationLevel} ({noiseStats.processingLatency.toFixed(1)}ms)
                    </span>
                  ) : (
                    <span className="text-gray-500">❌ Disabled</span>
                  )}
                </div>
                
                {/* Noise Floor Display */}
                {noiseStats.enabled && (
                  <div className="text-xs text-blue-400 mt-1">
                    Noise Floor: {noiseStats.noiseFloor.toFixed(1)}dB | Level: {noiseStats.currentLevel.toFixed(1)}dB
                  </div>
                )}
                
                {/* Debug VAD Button */}
                <button
                  onClick={async () => {
                    console.log('🧪 Manual VAD Test Started');
                    console.log('🔍 Checking global window objects...');
                    console.log('window.ort:', window.ort);
                    console.log('window.vad:', window.vad);
                    
                    if (window.vad) {
                      try {
                        console.log('🔧 Attempting manual VAD initialization...');
                        const vadOptions = {
                          orthConfig: {
                            wasmPaths: '/vad/',
                          },
                        };
                        
                        const detector = await window.vad.MicVAD.new(vadOptions);
                        console.log('✅ Manual VAD creation successful!', detector);
                        setVadReady(true);
                      } catch (error) {
                        console.error('❌ Manual VAD creation failed:', error);
                      }
                    } else {
                      console.error('❌ VAD library not available in window');
                    }
                  }}
                  className="mt-2 px-3 py-1 text-xs bg-yellow-500/20 border border-yellow-400 rounded text-yellow-400 hover:bg-yellow-500/30 transition-colors"
                >
                  🧪 Test VAD
                </button>
              </div>
            </div>

            {/* Partial Transcription Display */}
            {partialTranscription && (
              <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-3 mb-4 max-w-sm">
                <div className="text-xs text-blue-400 mb-1">Partial Transcription:</div>
                <div className="text-sm text-white italic">"{partialTranscription}"</div>
              </div>
            )}

            {/* Action Button */}
            <div className="text-sm text-gray-300 max-w-sm">
              {isTTSPlaying 
                ? "🔇 Microphone disabled while TTS is playing (debugging mode). Listening will auto-resume when TTS completes."
                : isListening 
                  ? "🎤 Listening... Speak now and I'll transcribe using gRPC STT server" 
                  : "Click the microphone to start voice conversation with gRPC integration"
              }
            </div>
          </div>
        </div>

        {/* Right Side - Messages Panel */}
        <div className="flex flex-col bg-black/50 h-full min-h-0">
          <ConversationPanel 
            messages={messages}
            onClearConversation={clearConversation}
            onStopAudio={handleUserStopAudio}
            speakingMessageIndex={status === "speaking" ? messages.length - 1 : null}
          />
        </div>
      </div>

      {/* Global animation styles */}
      <style jsx global>{`
        @keyframes wave {
          0%, 100% { 
            transform: scaleY(0.8);
            opacity: 0.5;
          }
          50% { 
            transform: scaleY(1.8);
            opacity: 1;
          }
        }

        .wave-bar-1 {
          height: 30%;
          left: 15%;
          animation: wave 0.8s ease-in-out infinite;
          animation-delay: 0s;
        }
        
        .wave-bar-2 {
          height: 50%;
          left: 30%;
          animation: wave 1s ease-in-out infinite;
          animation-delay: 0.15s;
        }
        
        .wave-bar-3 {
          height: 70%;
          left: 50%;
          animation: wave 1.2s ease-in-out infinite;
          animation-delay: 0.3s;
        }
        
        .wave-bar-4 {
          height: 55%;
          left: 70%;
          animation: wave 1s ease-in-out infinite;
          animation-delay: 0.15s;
        }
        
        .wave-bar-5 {
          height: 35%;
          left: 85%;
          animation: wave 0.8s ease-in-out infinite;
          animation-delay: 0s;
        }
      `}</style>
    </div>
  );
}