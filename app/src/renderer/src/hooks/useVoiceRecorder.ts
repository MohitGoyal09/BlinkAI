import { useState, useRef, useCallback } from 'react'

interface VoiceRecorderState {
  isRecording: boolean
  isProcessing: boolean
  transcript: string
  error: string | null
  recordingDuration: number
}

interface UseVoiceRecorderOptions {
  onTranscript?: (transcript: string) => void
  onError?: (error: string) => void
  language?: string
}

// Check if Deepgram API key is available
const hasDeepgramKey = (): boolean => {
  // In Electron app, we can check the main process via IPC or environment
  // For now, check window.electronAPI if available
  return !!process.env.DEEPGRAM_API_KEY || !!(window as any).electronAPI?.hasDeepgramKey
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}) {
  const { onTranscript, onError, language = 'en' } = options

  const [state, setState] = useState<VoiceRecorderState>({
    isRecording: false,
    isProcessing: false,
    transcript: '',
    error: null,
    recordingDuration: 0,
  })

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number>(0)

  const startRecording = useCallback(async () => {
    try {
      // Check for browser support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Voice recording is not supported in this browser')
      }

      // Check if we have Deepgram API key
      if (!hasDeepgramKey()) {
        throw new Error('Deepgram API key is not configured. Please add DEEPGRAM_API_KEY to your environment variables.')
      }

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Create media recorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      })

      audioChunksRef.current = []
      startTimeRef.current = Date.now()

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        
        // Send to Deepgram for transcription
        setState(prev => ({ ...prev, isProcessing: true }))

        try {
          const apiKey = process.env.DEEPGRAM_API_KEY || ''
          const formData = new FormData()
          formData.append('file', audioBlob)

          const response = await fetch('https://api.deepgram.com/v1/listen', {
            method: 'POST',
            headers: {
              'Authorization': `Token ${apiKey}`,
            },
            body: formData,
          })

          if (!response.ok) {
            throw new Error(`Transcription failed: ${response.statusText}`)
          }

          const result = await response.json()
          const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || ''

          setState(prev => ({
            ...prev,
            isProcessing: false,
            transcript,
            recordingDuration: 0,
          }))

          if (transcript && onTranscript) {
            onTranscript(transcript)
          }
        } catch (error: any) {
          setState(prev => ({
            ...prev,
            isProcessing: false,
            error: error.message,
            recordingDuration: 0,
          }))
          if (onError) {
            onError(error.message)
          }
        }
      }

      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start(100) // Collect data every 100ms

      // Start duration timer
      recordingIntervalRef.current = setInterval(() => {
        const duration = Math.floor((Date.now() - startTimeRef.current) / 1000)
        setState(prev => ({ ...prev, recordingDuration: duration }))
      }, 1000)

      setState(prev => ({
        ...prev,
        isRecording: true,
        error: null,
        transcript: '',
      }))
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        error: error.message,
      }))
      if (onError) {
        onError(error.message)
      }
    }
  }, [language, onTranscript, onError])

  const stopRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
      
      // Stop all tracks
      mediaRecorder.stream.getTracks().forEach(track => track.stop())
    }

    // Clear interval
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current)
      recordingIntervalRef.current = null
    }

    setState(prev => ({ ...prev, isRecording: false }))
  }, [])

  const toggleRecording = useCallback(() => {
    if (state.isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }, [state.isRecording, startRecording, stopRecording])

  const clearTranscript = useCallback(() => {
    setState(prev => ({ ...prev, transcript: '', error: null }))
  }, [])

  return {
    ...state,
    toggleRecording,
    stopRecording,
    startRecording,
    clearTranscript,
    hasDeepgramKey: hasDeepgramKey(),
  }
}