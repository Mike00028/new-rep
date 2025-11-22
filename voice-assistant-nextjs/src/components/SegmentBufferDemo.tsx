'use client';

import React, { useRef, useState, useEffect } from 'react';
import { StreamingAudioPlayer, TextSegment } from '../lib/streamingAudioPlayer';

interface SegmentDisplay {
  id: string;
  text: string;
  status: 'pending' | 'playing' | 'completed';
  progress: number;
}

const SegmentBufferDemo: React.FC = () => {
  const [segments, setSegments] = useState<SegmentDisplay[]>([]);
  const [currentSegment, setCurrentSegment] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const streamingPlayerRef = useRef<StreamingAudioPlayer>(
    new StreamingAudioPlayer(
      () => {
        console.log("🔊 Audio playback completed");
        setIsPlaying(false);
      },
      // Segment callbacks only (VAD is handled separately)
      {
        onSegmentStart: (segment: TextSegment) => {
          console.log(`📝 Segment started: ${segment.id}`);
          setCurrentSegment(segment.id);
          setSegments(prev => prev.map(s => 
            s.id === segment.id 
              ? { ...s, status: 'playing' }
              : s
          ));
        },
        onTextDisplay: (segment: TextSegment, progress: number) => {
          console.log(`📝 Text display progress: ${segment.id} - ${Math.round(progress * 100)}%`);
          setSegments(prev => prev.map(s => 
            s.id === segment.id 
              ? { ...s, progress }
              : s
          ));
        },
        onSegmentEnd: (segment: TextSegment) => {
          console.log(`📝 Segment completed: ${segment.id}`);
          setSegments(prev => prev.map(s => 
            s.id === segment.id 
              ? { ...s, status: 'completed', progress: 1 }
              : s
          ));
          setCurrentSegment(null);
        }
      }
    )
  );

  // Demo function to simulate adding text segments
  const addDemoSegment = () => {
    const segmentId = `demo-segment-${Date.now()}`;
    const demoTexts = [
      "Hello there! This is a demonstration of our segment buffer system.",
      "Each text segment can be synchronized with its corresponding audio.",
      "You can see the real-time progress as the text is being spoken.",
      "This enables advanced features like lip-sync and avatar animation.",
      "The segment buffer ensures perfect text-audio coordination."
    ];
    
    const randomText = demoTexts[Math.floor(Math.random() * demoTexts.length)];
    
    // Add to display
    setSegments(prev => [...prev, {
      id: segmentId,
      text: randomText,
      status: 'pending',
      progress: 0
    }]);
    
    // Create text segment in streaming player
    const textSegment = streamingPlayerRef.current.createTextSegment(segmentId, randomText);
    
    // Simulate adding audio chunks (in real app, this comes from TTS)
    setTimeout(() => {
      // Simulate audio chunk data (dummy data for demo)
      const dummyAudioChunk = new Uint8Array(1024);
      streamingPlayerRef.current.addAudioToSegment(segmentId, dummyAudioChunk);
    }, 100);
  };

  const clearSegments = () => {
    setSegments([]);
    setCurrentSegment(null);
    streamingPlayerRef.current.stop();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'playing': return '🎵';
      case 'completed': return '✅';
      default: return '❓';
    }
  };

  const getProgressBar = (progress: number) => {
    const percentage = Math.round(progress * 100);
    return (
      <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
        <div 
          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
        <span className="text-xs text-gray-500 ml-2">{percentage}%</span>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">
          📝 Segment Buffer Demo
        </h2>
        
        <p className="text-gray-600 mb-6">
          This demonstrates the text-audio segment synchronization system. 
          Each text segment is coordinated with its corresponding audio for perfect synchronization.
        </p>

        <div className="flex gap-4 mb-6">
          <button
            onClick={addDemoSegment}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Add Demo Segment
          </button>
          
          <button
            onClick={clearSegments}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Clear Segments
          </button>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-700">
            Text Segments ({segments.length})
          </h3>
          
          {segments.length === 0 ? (
            <div className="text-gray-500 italic p-4 border-2 border-dashed border-gray-300 rounded-lg text-center">
              No segments yet. Click "Add Demo Segment" to see the synchronization in action.
            </div>
          ) : (
            <div className="space-y-3">
              {segments.map((segment) => (
                <div
                  key={segment.id}
                  className={`p-4 rounded-lg border-2 transition-all duration-300 ${
                    segment.status === 'playing'
                      ? 'border-blue-500 bg-blue-50'
                      : segment.status === 'completed'
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-300 bg-gray-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{getStatusIcon(segment.status)}</span>
                    <div className="flex-1">
                      <div className="text-sm text-gray-500 mb-1">
                        Segment ID: {segment.id}
                      </div>
                      <div className="text-gray-800 mb-2">
                        {segment.text}
                      </div>
                      {segment.status !== 'pending' && getProgressBar(segment.progress)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8 p-4 bg-gray-100 rounded-lg">
          <h4 className="font-semibold text-gray-700 mb-2">Current Status:</h4>
          <div className="space-y-1 text-sm text-gray-600">
            <div>Playing: {isPlaying ? 'Yes' : 'No'}</div>
            <div>Current Segment: {currentSegment || 'None'}</div>
            <div>Total Segments: {segments.length}</div>
            <div>Completed: {segments.filter(s => s.status === 'completed').length}</div>
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <h4 className="font-semibold text-blue-800 mb-2">💡 How It Works:</h4>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Text segments are created with unique IDs</li>
            <li>• Audio chunks are associated with their text segments</li>
            <li>• Real-time progress tracking shows synchronization</li>
            <li>• Callbacks enable advanced features like lip-sync</li>
            <li>• Perfect coordination between text display and audio playback</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SegmentBufferDemo;