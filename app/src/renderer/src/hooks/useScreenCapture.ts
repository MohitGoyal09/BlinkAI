import { useState, useRef, useCallback } from 'react'

interface ScreenCaptureState {
  isCapturing: boolean
  capturedImage: string | null
  error: string | null
}

interface UseScreenCaptureOptions {
  onCapture?: (imageData: string) => void
  onError?: (error: string) => void
}

export function useScreenCapture(options: UseScreenCaptureOptions = {}) {
  const { onCapture, onError } = options

  const [state, setState] = useState<ScreenCaptureState>({
    isCapturing: false,
    capturedImage: null,
    error: null,
  })

  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // Check if we're in Electron
  const isElectron = !!(window as any).electronAPI

  const captureScreen = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isCapturing: true, error: null }))

      // Use Electron's desktopCapturer if available
      if (isElectron && (window as any).electronAPI?.captureScreen) {
        const imageData = await (window as any).electronAPI.captureScreen()
        
        setState(prev => ({
          ...prev,
          isCapturing: false,
          capturedImage: imageData,
        }))

        if (onCapture) {
          onCapture(imageData)
        }
        return imageData
      }

      // Fallback: use getDisplayMedia API (browser/Web-compatible)
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'never',
        } as MediaTrackConstraints,
        audio: false,
      })

      streamRef.current = stream

      // Create video element to capture frame
      const video = document.createElement('video')
      videoRef.current = video
      video.srcObject = stream
      video.style.display = 'none'
      document.body.appendChild(video)

      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play()
          resolve()
        }
      })

      // Wait a moment for the video to render
      await new Promise(resolve => setTimeout(resolve, 100))

      // Capture frame
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        throw new Error('Failed to get canvas context')
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = canvas.toDataURL('image/png')

      // Cleanup
      stopCapture()

      setState(prev => ({
        ...prev,
        isCapturing: false,
        capturedImage: imageData,
      }))

      if (onCapture) {
        onCapture(imageData)
      }

      return imageData
    } catch (error: any) {
      console.error('Screen capture error:', error)
      
      // Handle user cancellation gracefully
      if (error.name === 'NotAllowedError') {
        setState(prev => ({
          ...prev,
          isCapturing: false,
          error: 'Screen capture was cancelled',
        }))
        if (onError) {
          onError('Screen capture was cancelled')
        }
        return null
      }

      setState(prev => ({
        ...prev,
        isCapturing: false,
        error: error.message || 'Failed to capture screen',
      }))

      if (onError) {
        onError(error.message || 'Failed to capture screen')
      }
      return null
    }
  }, [onCapture, onError, isElectron])

  const stopCapture = useCallback(() => {
    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }

    // Remove video element
    if (videoRef.current && videoRef.current.parentNode) {
      videoRef.current.parentNode.removeChild(videoRef.current)
      videoRef.current = null
    }

    setState(prev => ({ ...prev, isCapturing: false }))
  }, [])

  const clearCapture = useCallback(() => {
    setState(prev => ({
      ...prev,
      capturedImage: null,
      error: null,
    }))
  }, [])

  return {
    ...state,
    captureScreen,
    stopCapture,
    clearCapture,
    isElectron,
  }
}
