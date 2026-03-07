/**
 * Voice Button Component
 * 
 * Deepgram-powered speech-to-text button for the chat input.
 * Like FlickAI - tap to record, words appear as you speak.
 */
import React from 'react';
import { useDeepgramSTT } from '../hooks/useDeepgramSTT';

interface VoiceButtonProps {
  /** Called when transcript is ready (final) */
  onTranscript: (text: string) => void;
  /** Optional callback for interim results */
  onInterimTranscript?: (text: string) => void;
  /** Optional callback for errors */
  onError?: (error: string) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Deepgram API key (optional, defaults to env) */
  apiKey?: string;
}

export function VoiceButton({ 
  onTranscript, 
  onInterimTranscript,
  onError, 
  disabled,
  apiKey 
}: VoiceButtonProps) {
  const {
    isRecording,
    isConnecting,
    interimTranscript,
    finalTranscript,
    fullTranscript,
    error,
    recordingDuration,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useDeepgramSTT({
    apiKey,
    onTranscript: (text, isFinal) => {
      if (isFinal) {
        onTranscript(text);
      }
    },
    onError,
  });

  // Send interim transcript updates
  React.useEffect(() => {
    if (interimTranscript && onInterimTranscript) {
      onInterimTranscript(interimTranscript);
    }
  }, [interimTranscript, onInterimTranscript]);

  // Format duration as MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Connecting state (initializing)
  if (isConnecting) {
    return (
      <button
        disabled
        className="voice-btn connecting"
        title="Connecting..."
        type="button"
      >
        <span className="voice-spinner" />
        <style>{`
          .voice-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border: 1px solid #e5e7eb;
            border-radius: 50%;
            background: #f3f4f6;
            cursor: wait;
            transition: all 0.2s;
          }
          .voice-spinner {
            width: 16px;
            height: 16px;
            border: 2px solid #e5e7eb;
            border-top-color: #6b7280;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </button>
    );
  }

  // Recording state - show active recording UI
  if (isRecording) {
    return (
      <div className="voice-recording-container">
        <button
          onClick={handleClick}
          className="voice-btn recording"
          title="Click to stop recording"
          type="button"
        >
          <span className="voice-pulse-ring" />
          <svg 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="currentColor"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
        
        <span className="recording-timer">{formatDuration(recordingDuration)}</span>
        
        {fullTranscript && (
          <span className="recording-preview">
            {fullTranscript.length > 30 
              ? fullTranscript.substring(0, 30) + '...' 
              : fullTranscript}
          </span>
        )}
        
        <style>{`
          .voice-recording-container {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 12px;
            background: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 20px;
          }
          .voice-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border: none;
            border-radius: 50%;
            background: #ef4444;
            color: white;
            cursor: pointer;
            position: relative;
            transition: all 0.2s;
          }
          .voice-btn:hover {
            background: #dc2626;
            transform: scale(1.05);
          }
          .voice-pulse-ring {
            position: absolute;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: rgba(239, 68, 68, 0.4);
            animation: pulse-ring 1.5s ease-out infinite;
          }
          @keyframes pulse-ring {
            0% { transform: scale(1); opacity: 1; }
            100% { transform: scale(1.5); opacity: 0; }
          }
          .recording-timer {
            font-size: 13px;
            font-weight: 500;
            color: #dc2626;
            font-variant-numeric: tabular-nums;
          }
          .recording-preview {
            font-size: 12px;
            color: #6b7280;
            max-width: 150px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        `}</style>
      </div>
    );
  }

  // Default state - microphone button
  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className="voice-btn"
      title="Voice input (Deepgram)"
      type="button"
    >
      <svg 
        width="18" 
        height="18" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2"
        strokeLinecap="round" 
        strokeLinejoin="round"
      >
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </svg>
      
      <style>{`
        .voice-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border: 1px solid #e5e7eb;
          border-radius: 50%;
          background: white;
          color: #6b7280;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .voice-btn:hover {
          background: #f3f4f6;
          color: #374151;
          border-color: #d1d5db;
          transform: scale(1.05);
        }
        .voice-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }
        .voice-btn:active {
          transform: scale(0.95);
        }
      `}</style>
    </button>
  );
}

export default VoiceButton;
