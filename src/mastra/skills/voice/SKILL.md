---
description: Voice interaction and transcription capabilities for hands-free AI assistance
---

# Voice Mode Skill

Enables voice-based interaction with the AI assistant using Deepgram for speech-to-text transcription.

## Capabilities

- **Speech-to-Text**: Convert voice input to text using Deepgram API
- **Voice Activity Detection**: Automatically detect when user starts/stops speaking
- **Push-to-Talk**: Hold button to record, release to send
- **Continuous Listening**: Always-on voice mode with wake word detection
- **Real-time Transcription**: Stream transcription results as user speaks

## Tools

### voice_transcribe
Transcribe audio data to text using Deepgram.

**Input:**
- `audioData`: Base64 encoded audio data (WebM/Opus format)
- `language`: Target language code (default: 'en')

**Output:**
- `transcript`: Transcribed text
- `confidence`: Confidence score
- `isFinal`: Whether transcription is complete

### voice_start_recording
Start voice recording session.

**Input:**
- `mode`: 'push-to-talk' | 'continuous'
- `language`: Target language code

**Output:**
- `sessionId`: Recording session ID
- `status`: 'recording' | 'error'

### voice_stop_recording
Stop voice recording and get final transcription.

**Input:**
- `sessionId`: Recording session ID

**Output:**
- `transcript`: Final transcribed text
- `duration`: Recording duration in seconds

## Usage Examples

```typescript
// Start recording
const session = await tools.voice_start_recording({
  mode: 'push-to-talk',
  language: 'en'
});

// Stop and get transcription
const result = await tools.voice_stop_recording({
  sessionId: session.sessionId
});
```

## Configuration

Requires `DEEPGRAM_API_KEY` environment variable.

## Best Practices

1. Use push-to-talk in noisy environments
2. Enable continuous mode for hands-free operation
3. Speak clearly and at moderate pace for best accuracy
4. Use noise cancellation when available