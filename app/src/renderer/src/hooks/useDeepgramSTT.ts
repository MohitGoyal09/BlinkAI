/**
 * Deepgram Streaming Speech-to-Text Hook
 * 
 * Real-time voice transcription using Deepgram's WebSocket API.
 * Like FlickAI - fast, accurate, words appear as you speak.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

interface UseDeepgramSTTOptions {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  language?: string;
  apiKey?: string;
}

interface DeepgramSTTState {
  isRecording: boolean;
  isConnecting: boolean;
  interimTranscript: string;
  finalTranscript: string;
  error: string | null;
  recordingDuration: number;
}

export function useDeepgramSTT(options: UseDeepgramSTTOptions) {
  const { 
    onTranscript, 
    onError, 
    language = 'en-US',
    apiKey 
  } = options;

  const [state, setState] = useState<DeepgramSTTState>({
    isRecording: false,
    isConnecting: false,
    interimTranscript: '',
    finalTranscript: '',
    error: null,
    recordingDuration: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const transcriptBufferRef = useRef<string>('');

  // Get API key from environment or prop
  const getApiKey = useCallback(() => {
    return apiKey || 
           import.meta.env.VITE_DEEPGRAM_API_KEY ||
           (window as any).electronAPI?.getDeepgramKey?.();
  }, [apiKey]);

  // Start recording with Deepgram streaming
  const startRecording = useCallback(async () => {
    const key = getApiKey();
    
    if (!key) {
      const error = 'Deepgram API key not configured. Add VITE_DEEPGRAM_API_KEY to your .env file.';
      setState(prev => ({ ...prev, error }));
      onError?.(error);
      return;
    }

    try {
      setState(prev => ({ 
        ...prev, 
        isConnecting: true, 
        error: null,
        interimTranscript: '',
        finalTranscript: ''
      }));

      transcriptBufferRef.current = '';

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      streamRef.current = stream;

      // Build Deepgram WebSocket URL with parameters
      const params = new URLSearchParams({
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        language: language.split('-')[0], // 'en-US' -> 'en'
        punctuate: 'true',
        interim_results: 'true',
        smart_format: 'true',
        filler_words: 'false',
        vad_events: 'true',
        endpointing: '500',
      });

      // Connect to Deepgram WebSocket
      const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
      const ws = new WebSocket(wsUrl, ['token', key]);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Deepgram] WebSocket connected');
        setState(prev => ({ 
          ...prev, 
          isConnecting: false, 
          isRecording: true 
        }));
        
        startTimeRef.current = Date.now();
        
        // Start duration timer
        recordingTimerRef.current = setInterval(() => {
          const duration = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setState(prev => ({ ...prev, recordingDuration: duration }));
        }, 1000);

        // Start MediaRecorder to send audio chunks
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus'
        });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            event.data.arrayBuffer().then((buffer) => {
              ws.send(buffer);
            });
          }
        };

        mediaRecorder.start(100); // Send chunks every 100ms
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'Results') {
            const transcript = data.channel?.alternatives?.[0]?.transcript || '';
            const isFinal = data.is_final || false;

            if (transcript) {
              if (isFinal) {
                // Final result - add to buffer
                transcriptBufferRef.current += (transcriptBufferRef.current ? ' ' : '') + transcript;
                setState(prev => ({ 
                  ...prev, 
                  finalTranscript: transcriptBufferRef.current,
                  interimTranscript: ''
                }));
                onTranscript(transcriptBufferRef.current, true);
              } else {
                // Interim result - show live preview
                const fullInterim = transcriptBufferRef.current + 
                  (transcriptBufferRef.current ? ' ' : '') + transcript;
                setState(prev => ({ ...prev, interimTranscript: fullInterim }));
                onTranscript(fullInterim, false);
              }
            }
          } else if (data.type === 'SpeechStarted') {
            console.log('[Deepgram] Speech started');
          } else if (data.type === 'SpeechEnded') {
            console.log('[Deepgram] Speech ended');
          }
        } catch (err) {
          console.error('[Deepgram] Error parsing message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('[Deepgram] WebSocket error:', error);
        const errorMsg = 'Deepgram connection error. Please check your API key.';
        setState(prev => ({ ...prev, error: errorMsg, isConnecting: false }));
        onError?.(errorMsg);
        stopRecording();
      };

      ws.onclose = (event) => {
        console.log('[Deepgram] WebSocket closed:', event.code, event.reason);
        if (event.code !== 1000 && state.isRecording) {
          const errorMsg = `Connection closed unexpectedly (code: ${event.code})`;
          setState(prev => ({ ...prev, error: errorMsg }));
          onError?.(errorMsg);
        }
        stopRecording();
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to start recording';
      console.error('[Deepgram] Start error:', error);
      setState(prev => ({ 
        ...prev, 
        isConnecting: false, 
        isRecording: false,
        error: errorMsg 
      }));
      onError?.(errorMsg);
    }
  }, [getApiKey, language, onTranscript, onError, state.isRecording]);

  // Stop recording
  const stopRecording = useCallback(() => {
    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // Stop stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'CloseStream' }));
      wsRef.current.close(1000, 'Recording stopped');
      wsRef.current = null;
    }

    // Clear timer
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    setState(prev => ({
      ...prev,
      isRecording: false,
      isConnecting: false,
      interimTranscript: '',
    }));
  }, []);

  // Cancel recording without keeping transcript
  const cancelRecording = useCallback(() => {
    transcriptBufferRef.current = '';
    stopRecording();
    setState(prev => ({
      ...prev,
      finalTranscript: '',
      interimTranscript: '',
      recordingDuration: 0,
    }));
  }, [stopRecording]);

  // Reset state
  const reset = useCallback(() => {
    transcriptBufferRef.current = '';
    setState({
      isRecording: false,
      isConnecting: false,
      interimTranscript: '',
      finalTranscript: '',
      error: null,
      recordingDuration: 0,
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  return {
    // State
    isRecording: state.isRecording,
    isConnecting: state.isConnecting,
    interimTranscript: state.interimTranscript,
    finalTranscript: state.finalTranscript,
    fullTranscript: state.finalTranscript || state.interimTranscript,
    error: state.error,
    recordingDuration: state.recordingDuration,
    
    // Actions
    startRecording,
    stopRecording,
    cancelRecording,
    reset,
  };
}

export default useDeepgramSTT;
