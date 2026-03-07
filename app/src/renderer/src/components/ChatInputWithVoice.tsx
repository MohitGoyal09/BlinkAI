/**
 * ChatInput with Voice Integration
 * 
 * Example wrapper showing how to integrate VoiceButton into ChatInput.
 * Uses Deepgram for fast, accurate speech-to-text like FlickAI.
 */
import { memo, useCallback, useState } from 'react';
import ChatInput from './ChatInput';
import { VoiceButton } from './VoiceButton';

interface ChatInputWithVoiceProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  variant?: 'home' | 'reply';
  placeholder?: string;
  currentModeId?: string;
  onModeSwitch?: (modeId: string) => void;
  deepgramApiKey?: string;
}

/**
 * ChatInput with integrated VoiceButton
 * 
 * Usage:
 * ```tsx
 * <ChatInputWithVoice
 *   value={prompt}
 *   onChange={setPrompt}
 *   onSend={handleSend}
 *   deepgramApiKey={process.env.VITE_DEEPGRAM_API_KEY}
 * />
 * ```
 */
export const ChatInputWithVoice = memo(function ChatInputWithVoice({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  isLoading,
  variant,
  placeholder,
  currentModeId,
  onModeSwitch,
  deepgramApiKey,
}: ChatInputWithVoiceProps) {
  const [interimText, setInterimText] = useState('');

  // Handle final transcript from voice
  const handleVoiceTranscript = useCallback((transcript: string) => {
    // Append to existing text with space
    const newValue = value 
      ? value + (value.endsWith(' ') ? '' : ' ') + transcript
      : transcript;
    onChange(newValue);
    setInterimText('');
  }, [value, onChange]);

  // Handle interim (live) transcript
  const handleInterimTranscript = useCallback((text: string) => {
    setInterimText(text);
  }, []);

  // Handle voice errors
  const handleVoiceError = useCallback((error: string) => {
    console.error('[VoiceButton]', error);
    // Optionally show toast/notification
  }, []);

  // Combine actual value with interim transcript for display
  const displayValue = interimText 
    ? (value ? value + ' ' : '') + interimText
    : value;

  return (
    <div className="chat-input-with-voice">
      <ChatInput
        value={displayValue}
        onChange={onChange}
        onSend={onSend}
        onStop={onStop}
        disabled={disabled}
        isLoading={isLoading}
        variant={variant}
        placeholder={placeholder}
        currentModeId={currentModeId}
        onModeSwitch={onModeSwitch}
      />
      
      {/* Voice button positioned in the input area */}
      <div className="voice-button-wrapper">
        <VoiceButton
          onTranscript={handleVoiceTranscript}
          onInterimTranscript={handleInterimTranscript}
          onError={handleVoiceError}
          disabled={disabled || isLoading}
          apiKey={deepgramApiKey}
        />
      </div>
      
      <style>{`
        .chat-input-with-voice {
          position: relative;
        }
        .voice-button-wrapper {
          position: absolute;
          right: 80px;
          bottom: 12px;
          z-index: 10;
        }
      `}</style>
    </div>
  );
});

export default ChatInputWithVoice;
