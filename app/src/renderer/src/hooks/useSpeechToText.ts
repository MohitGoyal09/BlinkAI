/**
 * Simple Speech-to-Text Hook
 * 
 * A focused hook for voice input that converts speech to text
 * and inserts it into the chat prompt box. Like FlickAI's simple STT.
 */
import { useState, useRef, useCallback } from 'react';

interface UseSpeechToTextOptions {
  /** Called when transcript is ready */
  onTranscript: (text: string) => void;
  /** Called on error */
  onError?: (error: string) => void;
  /** Language code (default: 'en-US') */
  language?: string;
}

interface SpeechToTextState {
  isRecording: boolean;
  isTranscribing: boolean;
  transcript: string;
  error: string | null;
  recordingDuration: number;
}

export function useSpeechToText(options: UseSpeechToTextOptions) {
  const { onTranscript, onError, language = 'en-US' } = options;

  const [state, setState] = useState<SpeechToTextState>({
    isRecording: false,
    isTranscribing: false,
    transcript: '',
    error: null,
    recordingDuration: 0,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  // Start recording audio
  const startRecording = useCallback(async () => {
    try {
      // Reset state
      setState({
        isRecording: true,
        isTranscribing: false,
        transcript: '',
        error: null,
        recordingDuration: 0,
      });

      audioChunksRef.current = [];

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        } 
      });

      // Create media recorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') 
          ? 'audio/webm' 
          : 'audio/mp4',
      });

      mediaRecorderRef.current = mediaRecorder;

      // Handle data available
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Handle recording stop
      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());

        // Process audio
        const audioBlob = new Blob(audioChunksRef.current, { 
          type: mediaRecorder.mimeType 
        });
        
        await transcribeAudio(audioBlob);
      };

      // Start recording
      mediaRecorder.start(100); // Collect data every 100ms
      startTimeRef.current = Date.now();

      // Update duration
      recordingTimerRef.current = setInterval(() => {
        const duration = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setState(prev => ({ ...prev, recordingDuration: duration }));
      }, 1000);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start recording';
      setState(prev => ({ ...prev, isRecording: false, error: errorMessage }));
      onError?.(errorMessage);
    }
  }, [language, onError]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording) {
      mediaRecorderRef.current.stop();
      
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }

      setState(prev => ({ ...prev, isRecording: false, isTranscribing: true }));
    }
  }, [state.isRecording]);

  // Cancel recording without transcribing
  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording) {
      mediaRecorderRef.current.stop();
      
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }

      // Don't transcribe, just reset
      setState({
        isRecording: false,
        isTranscribing: false,
        transcript: '',
        error: null,
        recordingDuration: 0,
      });
    }
  }, [state.isRecording]);

  // Transcribe audio using Deepgram
  const transcribeAudio = async (audioBlob: Blob) => {
    try {
      setState(prev => ({ ...prev, isTranscribing: true }));

      // Check for API key
      const apiKey = import.meta.env.VITE_DEEPGRAM_API_KEY || 
                     (window as any).electronAPI?.getDeepgramKey?.();

      if (!apiKey) {
        throw new Error('Deepgram API key not configured. Add VITE_DEEPGRAM_API_KEY to your .env file.');
      }

      // Convert blob to base64
      const arrayBuffer = await audioBlob.arrayBuffer();
      const base64Audio = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      // Call Deepgram API
      const response = await fetch('https://api.deepgram.com/v1/listen', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'audio/webm',
        },
        body: audioBlob,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.err_msg || `Transcription failed: ${response.statusText}`);
      }

      const result = await response.json();
      const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

      if (transcript) {
        setState(prev => ({ ...prev, transcript, isTranscribing: false }));
        onTranscript(transcript);
      } else {
        throw new Error('No speech detected. Please try speaking more clearly.');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Transcription failed';
      setState(prev => ({ ...prev, isTranscribing: false, error: errorMessage }));
      onError?.(errorMessage);
    }
  };

  // Reset state
  const reset = useCallback(() => {
    setState({
      isRecording: false,
      isTranscribing: false,
      transcript: '',
      error: null,
      recordingDuration: 0,
    });
  }, []);

  return {
    // State
    isRecording: state.isRecording,
    isTranscribing: state.isTranscribing,
    recordingDuration: state.recordingDuration,
    transcript: state.transcript,
    error: state.error,
    
    // Actions
    startRecording,
    stopRecording,
    cancelRecording,
    reset,
  };
}

export default useSpeechToText;
