"use client";

import { useRef, useEffect, useState } from "react";
import { marked } from "marked";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type CodeBlock = {
  language: string;
  code: string;
  fullBlock: string;
};

interface ConversationPanelProps {
  messages: Message[];
  onClearConversation: () => void;
  onStopAudio: () => void;
  speakingMessageIndex: number | null;
}

export default function ConversationPanel({ messages, onClearConversation, onStopAudio, speakingMessageIndex }: ConversationPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [codeModal, setCodeModal] = useState<{
    isOpen: boolean;
    code: string;
    language: string;
  }>({ isOpen: false, code: '', language: '' });
  
  // Configure marked.js properly
  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  // Function to detect and extract code blocks
  const detectCodeBlocks = (content: string): CodeBlock[] => {
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    const blocks: CodeBlock[] = [];
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      blocks.push({
        language: match[1] || 'text',
        code: match[2].trim(),
        fullBlock: match[0]
      });
    }
    return blocks;
  };



  // Function to render message content with code blocks and markdown
  const renderMessageContent = (content: string) => {
    const codeBlocks = detectCodeBlocks(content);
    
    if (codeBlocks.length === 0) {
      // No code blocks, just use marked.js
      const processedContent = content.replace(/\n(\d+\.)/g, '\n\n$1'); // Add spacing before numbered lists
      
      try {
        const html = marked(processedContent);
        
        // If marked.js fails to generate proper HTML, use fallback
        if (!html || html === processedContent) {
          const fallbackHtml = processedContent
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
          
          return (
            <div 
              className="text-sm leading-relaxed [&>strong]:font-bold"
              dangerouslySetInnerHTML={{ __html: fallbackHtml }}
            />
          );
        }
        
        return (
          <div 
            className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none [&_p]:text-gray-100 [&_strong]:text-white [&_em]:text-gray-200 [&_code]:bg-gray-900/50 [&_code]:text-yellow-300 [&_code]:px-2 [&_code]:py-1 [&_code]:rounded [&_ul]:text-gray-100 [&_ol]:text-gray-100 [&_li]:text-gray-100 [&_a]:text-blue-400 [&_a]:underline hover:[&_a]:text-blue-300"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      } catch (error) {
        console.error('❌ marked.js error:', error);
        return <div className="text-sm leading-relaxed whitespace-pre-wrap">{content}</div>;
      }
    }

    const parts = [];
    let lastIndex = 0;

    codeBlocks.forEach((block, idx) => {
      const blockStart = content.indexOf(block.fullBlock, lastIndex);
      
      // Add text before code block
      if (blockStart > lastIndex) {
        const textContent = content.slice(lastIndex, blockStart);
        let processedContent = textContent.replace(/\\n/g, '\n');
        processedContent = processedContent.replace(/\n\*/g, '\n\n*'); // Add spacing before bullet points
        const html = marked(processedContent);
        parts.push(
          <div 
            key={`text-${idx}`}
            className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      }

      // Add code block with click to view button
      parts.push(
        <div key={`code-${idx}`} className="my-3 p-3 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400 uppercase font-mono">
              {block.language} Code
            </span>
            <button
              onClick={() => setCodeModal({
                isOpen: true,
                code: block.code,
                language: block.language
              })}
              className="px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 hover:text-blue-300 rounded-md border border-blue-500/30 transition-all duration-200 text-xs font-medium flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Click to view results
            </button>
          </div>
          <pre className="text-xs text-gray-300 font-mono bg-gray-800/30 p-2 rounded overflow-x-auto max-h-20 overflow-y-auto">
            <code>{block.code.length > 150 ? block.code.slice(0, 150) + '...' : block.code}</code>
          </pre>
        </div>
      );

      lastIndex = blockStart + block.fullBlock.length;
    });

    // Add remaining text after last code block
    if (lastIndex < content.length) {
      const textContent = content.slice(lastIndex);
      let processedContent = textContent.replace(/\\n/g, '\n');
      processedContent = processedContent.replace(/\n\*/g, '\n\n*'); // Add spacing before bullet points
      const html = marked(processedContent);
      parts.push(
        <div 
          key="text-end"
          className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }

    return <div>{parts}</div>;
  };

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="p-6 border-b border-white/10 flex-shrink-0 bg-black/30">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-200">Conversation</h3>
            {messages.length > 0 && (
              <button 
                onClick={onClearConversation}
                className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-6xl mb-4 opacity-80">💬</div>
                <p className="text-lg font-semibold text-gray-300">No messages yet</p>
                <p className="text-sm text-gray-500 mt-2">Start speaking to begin the conversation</p>
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => {
              // Skip empty messages
              if (msg.content.trim() === "") return null;
              
              return (
              <div
                key={idx}
                className={`flex items-start gap-3 animate-fade-in ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center flex-shrink-0 text-sm font-bold shadow-lg shadow-purple-500/20">
                    A
                  </div>
                )}
                <div className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-xs px-5 py-3 rounded-2xl backdrop-blur-xl transition-all hover:shadow-lg ${
                      msg.role === "user"
                        ? "bg-gradient-to-br from-blue-600 to-purple-600 text-white rounded-br-none shadow-lg shadow-blue-500/20 border border-blue-400/30"
                        : "bg-white/8 text-gray-100 rounded-bl-none shadow-lg shadow-black/20 border border-white/10 hover:border-white/20"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="text-sm leading-relaxed">
                        {renderMessageContent(msg.content)}
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                    )}
                  </div>
                </div>
                {msg.role === "user" && (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500 to-red-500 flex items-center justify-center flex-shrink-0 text-sm font-bold shadow-lg shadow-red-500/20">
                    U
                  </div>
                )}
              </div>
            );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Code Modal */}
      {codeModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg border border-gray-700 max-w-4xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold text-white">
                  {codeModal.language.toUpperCase()} Code
                </span>
                <span className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-sm font-mono">
                  {codeModal.language}
                </span>
              </div>
              <button
                onClick={() => setCodeModal({ isOpen: false, code: '', language: '' })}
                className="text-gray-400 hover:text-white transition-colors p-1"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-sm text-gray-200 font-mono bg-gray-800/50 p-4 rounded-lg overflow-x-auto">
                <code>{codeModal.code}</code>
              </pre>
            </div>
            <div className="p-4 border-t border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => navigator.clipboard.writeText(codeModal.code)}
                className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 hover:text-blue-300 rounded-md border border-blue-500/30 transition-all duration-200 text-sm font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy Code
              </button>
              <button
                onClick={() => setCodeModal({ isOpen: false, code: '', language: '' })}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-all duration-200 text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scrollbar styles */}
      <style jsx global>{`
        .scrollbar-thin::-webkit-scrollbar {
          width: 4px;
        }
        
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 2px;
        }
        
        .animate-fade-in {
          animation: fadeIn 0.3s ease-in-out;
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  );
}