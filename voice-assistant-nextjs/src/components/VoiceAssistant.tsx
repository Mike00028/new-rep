"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { AudioQueue } from "@/lib/audioQueue";
import { sanitizeForTTS } from "@/lib/textSanitizer";
import ConversationPanel from "./ConversationPanel";
import { 
  transcribeAudio, 
  generateChatStream, 
  synthesizeSpeech, 
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

declare global {
  interface Window {
    vad: {
      MicVAD: {
        new: (config: VadConfig) => Promise<VadInstance>;
      };
    };
  }
}

interface VadConfig {
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  redemptionFrames?: number;
  preSpeechPadFrames?: number;
  onSpeechStart?: () => void;
  onSpeechEnd: (audio: Float32Array) => void;
}

interface VadInstance {
  start: () => void;
  pause: () => void;
  destroy?: () => void;
}

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Status = "idle" | "recording" | "transcribing" | "thinking" | "speaking";

// Test messages for UI development
const TEST_MESSAGES: Message[] = [
  { role: "user", content: "What's the capital of France?" },
  { role: "assistant", content: "The capital of France is Paris. It's one of the most visited cities in the world, known for its art, fashion, gastronomy, and culture." },
  { role: "user", content: "How many people live there?" },
  { role: "assistant", content: "The city of Paris has approximately 2.2 million inhabitants, but the Paris metropolitan area has around 12 million people, making it one of Europe's largest metropolitan areas." },
  { role: "user", content: "What's a famous landmark?" },
  { role: "assistant", content: "The Eiffel Tower is probably the most iconic landmark in Paris. Built in 1889, it stands 330 meters tall and receives millions of visitors annually." },
  { role: "user", content: "Tell me about French cuisine" },
  { role: "assistant", content: "French cuisine is renowned worldwide for its sophistication and variety. Classic dishes include coq au vin, boeuf bourguignon, ratatouille, and crème brûlée. French pastries like croissants and macarons are also beloved globally." },
  { role: "user", content: "What language do they speak?" },
  { role: "assistant", content: "The official language is French. While many Parisians speak English, especially in tourist areas, learning a few French phrases is always appreciated by locals." },
  { role: "user", content: "Best time to visit?" },
  { role: "assistant", content: "Spring (April-June) and fall (September-November) are ideal times to visit Paris. The weather is pleasant, and there are fewer tourists compared to summer. Plus, you'll see beautiful blooms in spring or autumn foliage." },
  { role: "user", content: "How's the public transport?" },
  { role: "assistant", content: "Paris has an excellent public transportation system called the Métro, with 16 lines covering the entire city. It's efficient, affordable, and the fastest way to get around. There are also buses and RER trains for longer distances." },
  { role: "user", content: "Any museums you recommend?" },
  { role: "assistant", content: "The Louvre is a must-visit, housing the Mona Lisa and thousands of other artworks. Musée d'Orsay features impressive Impressionist works. For modern art, check out Centre Pompidou." },
  { role: "user", content: "What about nightlife?" },
  { role: "assistant", content: "Paris offers diverse nightlife options from cozy wine bars in the Marais to trendy clubs in the Pigalle district. The city is also known for its cabaret shows like the Moulin Rouge." },
  { role: "user", content: "Is it expensive?" },
  { role: "assistant", content: "Paris can be expensive, especially in tourist areas. However, you can enjoy it on a budget by eating at local bistros, using public transport, and visiting free attractions like Notre-Dame's exterior or the Sacré-Cœur." },
];

export default function VoiceAssistant() {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<Message[]>([]) ; // Load test messages
  const [language, setLanguage] = useState("en");
  const [isVadReady, setIsVadReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  // VAD responsiveness preset: affects end-of-speech detection latency; 'adaptive' auto-selects a preset
  const [vadMode, setVadMode] = useState<'adaptive' | 'ultra' | 'fast' | 'balanced' | 'reliable'>('balanced');
  const [adaptiveEffectiveMode, setAdaptiveEffectiveMode] = useState<'ultra' | 'fast' | 'balanced' | 'reliable'>('balanced');
  const graceMs = 150; // extra capture after VAD end to avoid clipping final phoneme
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const graceRecorderRef = useRef<MediaRecorder | null>(null);
  const graceChunksRef = useRef<Blob[]>([]);
  const isCapturingRef = useRef<boolean>(false);

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
            // Decode using AudioContext to get PCM float
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

  const vadRef = useRef<VadInstance | null>(null);
  const audioQueueRef = useRef<AudioQueue>(new AudioQueue());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isListeningRef = useRef<boolean>(false); // Track listening state in ref for callbacks
  const isProcessingRef = useRef<boolean>(false); // Prevent multiple simultaneous processing
  const ttsCancelledRef = useRef<boolean>(false); // Track if user canceled TTS mid-stream
  const streamingCancelledRef = useRef<boolean>(false); // Track if chat stream should abort
  const streamAbortRef = useRef<AbortController | null>(null); // AbortController for LLM streaming
  // Adaptive metrics
  const lastSpeechStartRef = useRef<number | null>(null);
  const interruptionTimestampsRef = useRef<number[]>([]);

  // Set mounted state after hydration
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Convert Float32Array to WAV blob
  const float32ToWav = useCallback((audioData: Float32Array, sampleRate: number): Blob => {
    const buffer = new ArrayBuffer(44 + audioData.length * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + audioData.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true); // PCM
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, audioData.length * 2, true);

    // Convert float32 to int16
    const offset = 44;
    for (let i = 0; i < audioData.length; i++) {
      const sample = Math.max(-1, Math.min(1, audioData[i]));
      view.setInt16(offset + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    return new Blob([buffer], { type: "audio/wav" });
  }, []);

  // Generate and queue TTS
  const generateAndQueueTTS = useCallback(async (text: string) => {
    try {
      // If user cancelled TTS, don't generate new audio
      if (ttsCancelledRef.current) {
        console.log('[TTS] Skipping generation because cancellation flag is set');
        return;
      }
      if (audioQueueRef.current.isStopped()) {
        console.log('[TTS] Skipping generation because audio queue is in stopped state');
        return;
      }
      // Sanitize markdown / formatting artifacts before sending to TTS
      const sanitized = sanitizeForTTS(text);
      const audioBlob = await synthesizeSpeech(sanitized, language);
      // Re-check cancellation after async TTS call (user may have pressed Stop meanwhile)
      if (ttsCancelledRef.current || audioQueueRef.current.isStopped()) {
        console.log('[TTS] Discarding synthesized audio due to post-generation cancellation/stop');
        return;
      }
      if (audioBlob) {
        const audioUrl = createAudioUrl(audioBlob);
        audioQueueRef.current.enqueue(audioUrl);
        // Set speaking status when first audio is queued
        setStatus("speaking");
      }
    } catch (error) {
      console.error("TTS Error:", error);
    }
  }, [language]);

  // Initialize session on mount
  useEffect(() => {
    const initSession = async () => {
      if (!sessionId) {
        const newSessionId = await createSession(language);
        setSessionId(newSessionId);
        console.log(`Initialized session: ${newSessionId}`);
      }
    };
    initSession();
  }, [language, sessionId]); // Include dependencies

  // Initialize VAD from CDN
  useEffect(() => {
    const initVAD = async () => {
      if (typeof window === "undefined") return;

      // Wait for window.vad to be available from CDN
      if (!window.vad) {
        setTimeout(initVAD, 500);
        return;
      }

      try {
        // Frame duration ~32ms (empirical from original comment 20 frames ≈0.65s)
        const frameMs = 32;
        // Configure presets: fast ends earlier (lower redemptionFrames), reliable waits longer.
        const presetConfig = {
          ultra: {
            redemptionFrames: 8, // ≈256ms pause
            positiveSpeechThreshold: 0.56,
            negativeSpeechThreshold: 0.44,
            preSpeechPadFrames: 18,
          },
          fast: {
            redemptionFrames: 11, // ≈350ms pause
            positiveSpeechThreshold: 0.58,
            negativeSpeechThreshold: 0.42,
            preSpeechPadFrames: 20, // slightly less padding
          },
          balanced: {
            redemptionFrames: 20, // ≈640ms pause (original)
            positiveSpeechThreshold: 0.6,
            negativeSpeechThreshold: 0.4,
            preSpeechPadFrames: 25,
          },
          reliable: {
            redemptionFrames: 31, // ≈1s pause for high certainty
            positiveSpeechThreshold: 0.63,
            negativeSpeechThreshold: 0.38,
            preSpeechPadFrames: 30,
          }
        } as const;
  const effectiveMode = vadMode === 'adaptive' ? adaptiveEffectiveMode : vadMode;
  const cfg = presetConfig[effectiveMode];
        const myvad = await window.vad.MicVAD.new({
          positiveSpeechThreshold: cfg.positiveSpeechThreshold,
          negativeSpeechThreshold: cfg.negativeSpeechThreshold,
          redemptionFrames: cfg.redemptionFrames,
          preSpeechPadFrames: cfg.preSpeechPadFrames,
          onSpeechStart: () => {
            // Only process if we're actually listening
            if (!isListeningRef.current) {
              console.log("Speech detected but not listening - ignoring");
              return;
            }
            isCapturingRef.current = true; // mark active speech capture
            lastSpeechStartRef.current = Date.now();
            
            // INTERRUPTION HANDLING: If audio is playing, stop it immediately
            if (audioQueueRef.current.getIsPlaying()) {
              console.log("🛑 User interrupted - stopping TTS playback");
              audioQueueRef.current.stopAll(); // Stop current audio and clear queue
              // Record interruption timestamp
              interruptionTimestampsRef.current.push(Date.now());
              if (interruptionTimestampsRef.current.length > 20) {
                interruptionTimestampsRef.current.shift();
              }
            }

            // Reset cancellation flags when new user speech starts
            ttsCancelledRef.current = false;
            streamingCancelledRef.current = false;
            
            console.log("Speech detected - recording started");
            setStatus("recording");
          },
          onSpeechEnd: async (audio: Float32Array) => {
            // Only process if we're actually listening
            if (!isListeningRef.current) {
              console.log("Speech ended but not listening - ignoring");
              return;
            }
            
            // Prevent multiple simultaneous processing
            if (isProcessingRef.current) {
              console.log("Already processing speech - ignoring duplicate");
              return;
            }
            
            isProcessingRef.current = true;
            console.log("Processing speech");
            setStatus("transcribing");

            // Grace buffer: append trailing frames for ultra/fast effective modes to avoid clipping
            const currentEffectiveMode = vadMode === 'adaptive' ? adaptiveEffectiveMode : vadMode;
            let finalAudio = audio;
            if (currentEffectiveMode === 'ultra' || currentEffectiveMode === 'fast') {
              try {
                const grace = await captureGraceBuffer();
                if (grace && grace.length > 0) {
                  const merged = new Float32Array(finalAudio.length + grace.length);
                  merged.set(finalAudio, 0);
                  merged.set(grace, finalAudio.length);
                  finalAudio = merged;
                  console.log(`[GraceCapture] Appended ${grace.length} samples (~${(grace.length / 16000 * 1000).toFixed(0)}ms)`);
                } else {
                  console.log('[GraceCapture] No grace data captured');
                }
              } catch (e) {
                console.warn('[GraceCapture] Failed to append grace buffer', e);
              }
            }
            
            // Convert Float32Array to WAV
            const wavBlob = float32ToWav(finalAudio, 16000);
            
            // Transcribe using original STT server only
            const transcriptionResult = await transcribeAudio(wavBlob, language);
            console.log('Transcription result:', transcriptionResult);
            const transcription = transcriptionResult.text;
            
            if (!transcription || transcriptionResult.error) {
              setStatus("idle");
              isProcessingRef.current = false; // Reset processing flag
              return;
            }

            const userMessage: Message = { role: "user", content: transcription };
            setMessages((prev) => [...prev, userMessage]);
            setStatus("thinking");

            // Stream AI response with session
            let currentChunk = "";
            let displayedResponse = "";
            let assistantMessageAdded = false;
            
            // Ensure we have a session ID before proceeding
            let currentSessionId = sessionId;
            if (!currentSessionId) {
              console.log('[DEBUG] No session ID, creating one...');
              currentSessionId = await createSession(language);
              setSessionId(currentSessionId);
              console.log(`[DEBUG] Created new session: ${currentSessionId}`);
            } else {
              console.log(`[DEBUG] Using existing sessionId: ${currentSessionId}`);
            }

            try {
              // Only send the new user message, not the full history
              // The session memory will maintain context
              const apiMessages: ApiMessage[] = [{
                role: userMessage.role,
                content: userMessage.content
              }];

              // Prepare abort controller for this streaming session
              if (streamAbortRef.current) {
                // Abort any previous stream before starting a new one
                try { streamAbortRef.current.abort(); } catch {}
              }
              streamAbortRef.current = new AbortController();
              for await (const chunk of generateChatStream(apiMessages, language, currentSessionId, streamAbortRef.current.signal)) {
                // Abort streaming if user pressed stop
                if (streamingCancelledRef.current) {
                  console.log('[STREAM] Cancellation detected - aborting stream loop');
                  break;
                }
                // Capture session ID from any chunk (especially the final one)
                if (chunk.session_id && chunk.session_id !== currentSessionId) {
                  console.log(`[DEBUG] Updating session ID from ${currentSessionId} to ${chunk.session_id}`);
                  currentSessionId = chunk.session_id;
                  setSessionId(currentSessionId);
                }
                
                if (chunk.text) {
                  currentChunk += chunk.text;

                  // Detect sentence boundaries - prioritize period/exclamation/question mark
                  // For commas, wait to see if more commas are coming (better phrasing)
                  const strongBoundary = currentChunk.match(/(?<!\d)[.!?]\s/);
                  
                  if (strongBoundary) {
                    // Found period, exclamation, or question mark - send immediately
                    const sentenceEnd = currentChunk.indexOf(strongBoundary[0]) + strongBoundary[0].length;
                    const sentence = currentChunk.slice(0, sentenceEnd).trim();
                    if (sentence) {
                      if (ttsCancelledRef.current) {
                        console.log('[TTS] Cancelled before sentence generation');
                      } else {
                      // AWAIT to ensure sentences are processed in order
                      await generateAndQueueTTS(sentence);
                      }
                      
                      // Update displayed text AFTER TTS is generated
                      displayedResponse += sentence + " ";
                      
                      // Add assistant message only when we have content
                      if (!assistantMessageAdded) {
                        const assistantMessage: Message = { role: "assistant", content: displayedResponse.trim() };
                        setMessages((prev) => [...prev, assistantMessage]);
                        assistantMessageAdded = true;
                      } else {
                        // Update existing message with smooth transition
                        setMessages((prev) => {
                          const newMessages = [...prev];
                          const lastMessage = newMessages[newMessages.length - 1];
                          if (lastMessage && lastMessage.role === "assistant") {
                            lastMessage.content = displayedResponse.trim();
                          }
                          return newMessages;
                        });
                      }
                    }
                    currentChunk = currentChunk.slice(sentenceEnd);
                  } else {
                    // Check for commas - only send if we have multiple commas (last one in sequence)
                    const commaMatches = currentChunk.match(/(?<!\d),\s/g);
                    if (commaMatches && commaMatches.length >= 2) {
                      // Find the last comma
                      const lastCommaIndex = currentChunk.lastIndexOf(',');
                      if (lastCommaIndex !== -1) {
                        const sentenceEnd = lastCommaIndex + 2; // comma + space
                        const sentence = currentChunk.slice(0, sentenceEnd).trim();
                        if (sentence) {
                          if (ttsCancelledRef.current) {
                            console.log('[TTS] Cancelled before comma sentence generation');
                          } else {
                            await generateAndQueueTTS(sentence);
                          }
                          displayedResponse += sentence + " ";
                          
                          if (!assistantMessageAdded) {
                            const assistantMessage: Message = { role: "assistant", content: displayedResponse.trim() };
                            setMessages((prev) => [...prev, assistantMessage]);
                            assistantMessageAdded = true;
                          } else {
                            setMessages((prev) => {
                              const newMessages = [...prev];
                              const lastMessage = newMessages[newMessages.length - 1];
                              if (lastMessage && lastMessage.role === "assistant") {
                                lastMessage.content = displayedResponse.trim();
                              }
                              return newMessages;
                            });
                          }
                        }
                        currentChunk = currentChunk.slice(sentenceEnd);
                      }
                    }
                  }
                }

                if (chunk.done) {
                  // Ensure session ID is saved from the final chunk
                  if (chunk.session_id && chunk.session_id !== sessionId) {
                    setSessionId(chunk.session_id);
                    console.log(`[DEBUG] Session ID saved from final chunk: ${chunk.session_id}`);
                  }
                  break;
                }
              }

              // Queue remaining text
              if (currentChunk.trim()) {
                // AWAIT to ensure final chunk is processed in order
                if (ttsCancelledRef.current) {
                  console.log('[TTS] Cancelled before final chunk generation');
                } else {
                  await generateAndQueueTTS(currentChunk.trim());
                }
                
                // Update displayed text with remaining content AFTER TTS
                displayedResponse += currentChunk.trim();
                
                // Handle final chunk
                if (!assistantMessageAdded) {
                  const assistantMessage: Message = { role: "assistant", content: displayedResponse.trim() };
                  setMessages((prev) => [...prev, assistantMessage]);
                  assistantMessageAdded = true;
                } else {
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage && lastMessage.role === "assistant") {
                      lastMessage.content = displayedResponse.trim();
                    }
                    return newMessages;
                  });
                }
              }

              // Wait for audio queue to finish
              await new Promise<void>((resolve) => {
                const checkQueue = () => {
                  if (ttsCancelledRef.current) {
                    console.log('[QUEUE] Cancellation flag set - resolving early');
                    resolve();
                    return;
                  }
                  if (audioQueueRef.current.getQueueLength() === 0 && !audioQueueRef.current.getIsPlaying()) {
                    resolve();
                  } else {
                    setTimeout(checkQueue, 500);
                  }
                };
                checkQueue();
              });

              setStatus("idle");
              isProcessingRef.current = false; // Reset processing flag
              // Adaptive heuristic update AFTER error or cancel: keep previous effective mode
            } catch (error) {
              console.error("Chat stream error:", error);
              setStatus("idle");
              isProcessingRef.current = false; // Reset processing flag on error
            }

            // --- Adaptive Mode Heuristic Update (at end of processing) ---
            if (vadMode === 'adaptive') {
              const now = Date.now();
              const start = lastSpeechStartRef.current;
              const durationMs = start ? (now - start) : 0;
              const recentWindowMs = 120000; // 2 minutes
              const recentInterruptions = interruptionTimestampsRef.current.filter(t => t >= now - recentWindowMs).length;
              let nextMode: 'ultra' | 'fast' | 'balanced' | 'reliable' = adaptiveEffectiveMode;
              if (recentInterruptions >= 4) {
                nextMode = 'ultra';
              } else if (durationMs < 1200) {
                nextMode = 'ultra';
              } else if (durationMs < 2500) {
                nextMode = 'fast';
              } else if (durationMs < 5000) {
                nextMode = 'balanced';
              } else {
                nextMode = 'reliable';
              }
              if (nextMode !== adaptiveEffectiveMode) {
                console.log(`[AdaptiveVAD] duration=${Math.round(durationMs)}ms interruptions=${recentInterruptions} switching ${adaptiveEffectiveMode} -> ${nextMode}`);
                setAdaptiveEffectiveMode(nextMode);
              } else {
                console.log(`[AdaptiveVAD] duration=${Math.round(durationMs)}ms interruptions=${recentInterruptions} keeping mode ${nextMode}`);
              }
            }
          },
        });

        vadRef.current = myvad;
        setIsVadReady(true);
      } catch (error) {
        console.error("Error initializing VAD:", error);
      }
    };

    initVAD();

    return () => {
      if (vadRef.current?.destroy) {
        vadRef.current.destroy();
      }
    };
  }, [messages, language, sessionId, float32ToWav, generateAndQueueTTS, vadMode, adaptiveEffectiveMode]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggleListening = () => {
    if (!vadRef.current || !isVadReady) return;

    if (isListening) {
      // Stop listening
      vadRef.current.pause();
      setIsListening(false);
      isListeningRef.current = false; // Update ref
      setStatus("idle");
      console.log("[UI] Stop button pressed - stopping VAD and attempting to halt any ongoing TTS");

      // Cancel any ongoing streaming / TTS generation
      ttsCancelledRef.current = true;
      streamingCancelledRef.current = true;

      // If audio is currently playing or queued, stop it now
      const queueLen = audioQueueRef.current.getQueueLength();
      const playing = audioQueueRef.current.getIsPlaying();
      console.log(`[AUDIO] Before stop: queueLength=${queueLen}, isPlaying=${playing}`);
      audioQueueRef.current.stopAll();
      // Abort any active streaming
      if (streamAbortRef.current) {
        try { streamAbortRef.current.abort(); console.log('[STREAM] AbortController triggered (listening toggle stop)'); } catch {}
      }
      console.log('[AUDIO] Audio queue forcibly stopped');
      console.log('[FLAGS] ttsCancelledRef:', ttsCancelledRef.current, 'streamingCancelledRef:', streamingCancelledRef.current);
    } else {
      // Start listening
      vadRef.current.start();
      setIsListening(true);
      isListeningRef.current = true; // Update ref
      // Reset cancellation flags when user starts fresh listening session
      ttsCancelledRef.current = false;
      streamingCancelledRef.current = false;
      audioQueueRef.current.resetStopFlag();
      console.log("[UI] Started listening - flags reset, ready to process speech");
    }
  };

  const clearConversation = async () => {
    setMessages([]);
    audioQueueRef.current.stop();
    setStatus("idle");
    
    // Delete current session and create new one
    if (sessionId) {
      await deleteSession(sessionId);
    }
    
    const newSessionId = await createSession(language);
    setSessionId(newSessionId);
  };

  // User requested to stop audio manually
  const handleUserStopAudio = () => {
    console.log('[USER ACTION] Stop audio requested');
    ttsCancelledRef.current = true;
    streamingCancelledRef.current = true;
    audioQueueRef.current.stopAll();
    if (streamAbortRef.current) {
      try { streamAbortRef.current.abort(); console.log('[STREAM] AbortController triggered (manual stop audio)'); } catch {}
    }
    setStatus('idle');
  };

  const getStatusLabel = () => {
    const getLabel = () => {
      switch (status) {
        case "recording":
          return "Listening...";
        case "transcribing":
          return "Transcribing...";
        case "thinking":
          return "Thinking...";
        case "speaking":
          return "Speaking...";
        default:
          return "Ready";
      }
    };

    return (
      <div>
      <p className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
        {getLabel()}
      </p>
</div>
    );
  };

  return (
    <div className="h-screen bg-black text-white overflow-hidden">
      {/* Grid Background Pattern */}
      {isMounted && (
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: "linear-gradient(0deg, transparent 24%, rgba(255, 255, 255, 0.05) 25%, rgba(255, 255, 255, 0.05) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, 0.05) 75%, rgba(255, 255, 255, 0.05) 76%, transparent 77%, transparent), linear-gradient(90deg, transparent 24%, rgba(255, 255, 255, 0.05) 25%, rgba(255, 255, 255, 0.05) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, 0.05) 75%, rgba(255, 255, 255, 0.05) 76%, transparent 77%, transparent)",
            backgroundSize: "50px 50px"
          }} />
        </div>
      )}

      {/* Ambient glow orbs */}
      {isMounted && (
        <>
          <div className="absolute top-20 right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-20 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        </>
      )}
      
      <div className="relative z-10 h-screen flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 bg-black/80 backdrop-blur-xl flex-shrink-0">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
                Voice Agent
              </h1>
              <p className="text-xs text-gray-500 mt-1">AI-powered voice conversation</p>
            </div>
            {/* <div className="text-right">
              <p className="text-lg font-semibold text-purple-300">{getStatusLabel()}</p>
            </div> */}
          </div>
        </div>

  {/* Main Content - 50/50 Split */}
  <div className="flex-1 grid grid-cols-2 gap-0 h-full min-h-0">
          
          {/* Left Side - Voice Interface */}
          <div className="flex flex-col items-center justify-center px-8 py-6 border-r-2 border-white/20 bg-gray-900/50 h-full min-h-0">
            <div className="w-full flex flex-col items-center justify-center">
              
              {/* Voice Visualizer Circle */}
              <div className="relative mb-16 flex items-center justify-center">
                {/* Outer rings - pulse when active */}
                {(status === "recording" || status === "speaking") && (
                  <>
                    <div className="absolute rounded-full bg-purple-500/30 animate-pulse" style={{width: '380px', height: '380px'}} />
                    <div className="absolute rounded-full bg-blue-500/20 animate-pulse" style={{width: '420px', height: '420px', animationDelay: '0.1s'}} />
                  </>
                )}
                
                {/* Main circle with waves */}
                <div className={`relative w-80 h-80 rounded-full flex items-center justify-center transition-all duration-500 backdrop-blur-sm border border-white/10 ${
                  status === "recording" 
                    ? "bg-gradient-to-br from-red-600 to-pink-600 shadow-2xl shadow-red-500/60 scale-105" 
                    : status === "speaking"
                    ? "bg-gradient-to-br from-emerald-500 to-teal-600 shadow-2xl shadow-emerald-500/60 scale-105"
                    : status === "thinking"
                    ? "bg-gradient-to-br from-blue-600 to-indigo-700 shadow-2xl shadow-blue-500/40 animate-pulse"
                    : status === "transcribing"
                    ? "bg-gradient-to-br from-amber-500 to-orange-600 shadow-2xl shadow-amber-500/50 animate-pulse"
                    : "bg-gradient-to-br from-gray-700 to-gray-800 shadow-2xl shadow-gray-600/30 hover:shadow-purple-500/40 cursor-pointer transition-all"
                }`}>
                  
                  {/* Animated Waves - show when recording or speaking */}
                  {(status === "recording" || status === "speaking") && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="absolute w-1.5 bg-white/90 rounded-full wave-bar-1" />
                      <div className="absolute w-1.5 bg-white/90 rounded-full wave-bar-2" />
                      <div className="absolute w-1.5 bg-white/90 rounded-full wave-bar-3" />
                      <div className="absolute w-1.5 bg-white/90 rounded-full wave-bar-4" />
                      <div className="absolute w-1.5 bg-white/90 rounded-full wave-bar-5" />
                    </div>
                  )}
                  
                  {/* Center Icon */}
                  <div className="relative z-10 text-white">
                    {status === "recording" && (
                      <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                      </svg>
                    )}
                    {status === "speaking" && (
                      <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                      </svg>
                    )}
                    {status === "thinking" && (
                      <svg className="w-24 h-24 animate-spin" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="2" opacity="0.3"/>
                        <circle cx="12" cy="5" r="2" opacity="0.3"/>
                        <circle cx="19" cy="12" r="2" opacity="0.3"/>
                      </svg>
                    )}
                    {status === "transcribing" && (
                      <svg className="w-24 h-24 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M21 15v4c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2v-4h18zm-2-8H5v8h14V7z"/>
                      </svg>
                    )}
                    {status === "idle" && (
                      <svg className="w-24 h-24" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                      </svg>
                    )}
                  </div>
                </div>
              </div>

              {/* Status Text */}
              <div className="text-center mb-10">
                <div className="inline-block px-6 py-3 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm">
                  <p className="text-xl font-medium text-white">{getStatusLabel()}</p>
                </div>
              </div>

              {/* Control Buttons */}
              <div className="flex gap-4 mb-10">
                <button
                  onClick={toggleListening}
                  disabled={!isVadReady}
                  className={`px-10 py-4 rounded-full font-semibold text-lg transition-all transform duration-200 flex items-center gap-2 ${
                    isListening
                      ? "bg-red-600 hover:bg-red-700 shadow-xl shadow-red-500/50 hover:scale-110 active:scale-95"
                      : "bg-gradient-to-br from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 shadow-xl shadow-purple-500/30 hover:scale-110 active:scale-95"
                  } ${!isVadReady ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {isListening ? "Stop" : "Start"}
                </button>
              </div>

              {/* Language Selector */}
              <div className="flex items-center gap-3 px-6 py-3 bg-white/5 backdrop-blur-xl rounded-full border border-white/10 hover:border-white/20 transition-all">
                <span className="text-xs text-gray-400">Language:</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="bg-transparent text-white text-sm font-medium focus:outline-none cursor-pointer"
                >
                  <option value="en" className="bg-slate-900">English</option>
                  <option value="hi" className="bg-slate-900">हिंदी</option>
                  <option value="te" className="bg-slate-900">తెలుగు</option>
                </select>
              </div>

              {/* VAD Responsiveness / Adaptive Selector (TEMPORARILY DISABLED)
              <div className="flex items-center gap-3 px-6 py-3 bg-white/5 backdrop-blur-xl rounded-full border border-white/10 hover:border-white/20 transition-all mt-4">
                <span className="text-xs text-gray-400">VAD Mode:</span>
                <select
                  value={vadMode}
                  onChange={(e) => setVadMode(e.target.value as 'adaptive' | 'ultra' | 'fast' | 'balanced' | 'reliable')}
                  className="bg-transparent text-white text-sm font-medium focus:outline-none cursor-pointer"
                >
                  <option value="adaptive" className="bg-slate-900">Adaptive (auto)</option>
                  <option value="ultra" className="bg-slate-900">Ultra (~0.25s + grace)</option>
                  <option value="fast" className="bg-slate-900">Fast (~0.35s)</option>
                  <option value="balanced" className="bg-slate-900">Balanced (~0.64s)</option>
                  <option value="reliable" className="bg-slate-900">Reliable (~1.0s)</option>
                </select>
                {vadMode === 'adaptive' && (
                  <span className="text-[10px] text-gray-400 ml-2">Effective: {adaptiveEffectiveMode}</span>
                )}
              </div>*/}
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

        @keyframes pulse-glow {
          0%, 100% {
            opacity: 0.3;
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            transform: scale(1.05);
          }
        }

        @keyframes float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-10px);
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

        .scrollbar-thin::-webkit-scrollbar {
          width: 6px;
        }
        
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
        }

        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
