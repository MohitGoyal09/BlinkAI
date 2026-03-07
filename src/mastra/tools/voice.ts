import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Voice transcription tool using Deepgram API
 */
export const voiceTranscribeTool = createTool({
  id: 'voice_transcribe',
  description: 'Transcribe audio data to text using Deepgram API',
  inputSchema: z.object({
    audioData: z.string().describe('Base64 encoded audio data (WebM/Opus format)'),
    language: z.string().default('en').describe('Target language code'),
  }),
  execute: async ({ audioData, language }: { audioData: string; language: string }) => {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY environment variable is required for voice transcription');
    }

    try {
      // Convert base64 to buffer
      const audioBuffer = Buffer.from(audioData, 'base64');

      // Call Deepgram API
      const response = await fetch('https://api.deepgram.com/v1/listen', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'audio/webm',
        },
        body: audioBuffer,
      });

      if (!response.ok) {
        throw new Error(`Deepgram API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const alternative = result.results?.channels?.[0]?.alternatives?.[0];

      return {
        transcript: alternative?.transcript || '',
        confidence: alternative?.confidence || 0,
        isFinal: true,
      };
    } catch (error: any) {
      console.error('Voice transcription error:', error);
      throw new Error(`Failed to transcribe audio: ${error.message}`);
    }
  },
});

/**
 * Tool to start a voice recording session
 */
export const voiceStartRecordingTool = createTool({
  id: 'voice_start_recording',
  description: 'Start a voice recording session',
  inputSchema: z.object({
    mode: z.enum(['push-to-talk', 'continuous']).describe('Recording mode'),
    language: z.string().default('en').describe('Target language code'),
  }),
  execute: async ({ mode, language }: { mode: 'push-to-talk' | 'continuous'; language: string }) => {
    // Generate session ID
    const sessionId = `voice-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Store session info (in memory for now)
    // This would be stored in a proper session manager in production
    return {
      sessionId,
      status: 'recording',
    };
  },
});

/**
 * Tool to stop voice recording
 */
export const voiceStopRecordingTool = createTool({
  id: 'voice_stop_recording',
  description: 'Stop voice recording and get final transcription',
  inputSchema: z.object({
    sessionId: z.string().describe('Recording session ID'),
  }),
  execute: async ({ sessionId }: { sessionId: string }) => {
    // This would retrieve the recorded audio and transcribe it
    // For now, return placeholder
    return {
      transcript: '',
      duration: 0,
    };
  },
});

/**
 * Tool to analyze voice command and determine intent
 */
export const voiceAnalyzeIntentTool = createTool({
  id: 'voice_analyze_intent',
  description: 'Analyze voice command to determine user intent',
  inputSchema: z.object({
    transcript: z.string().describe('Voice transcript to analyze'),
    context: z.string().optional().describe('Current context/conversation'),
  }),
  execute: async ({ transcript, context }: { transcript: string; context?: string }) => {
    const lowerTranscript = transcript.toLowerCase();
    
    // Simple intent detection based on keywords
    let intent: 'question' | 'command' | 'code_request' | 'explanation' | 'general_chat' = 'general_chat';
    let confidence = 0.5;
    const entities: Array<{ type: string; value: string }> = [];

    // Question detection
    if (lowerTranscript.match(/^(what|how|why|when|where|who|can you|could you|is there|are there)/)) {
      intent = 'question';
      confidence = 0.8;
    }
    // Code request detection
    else if (lowerTranscript.match(/(write|create|generate|code|function|script|implement)/)) {
      intent = 'code_request';
      confidence = 0.8;
    }
    // Command detection
    else if (lowerTranscript.match(/^(open|close|run|execute|stop|start|fix|debug)/)) {
      intent = 'command';
      confidence = 0.75;
    }
    // Explanation request
    else if (lowerTranscript.match(/(explain|describe|tell me about|what does|how does)/)) {
      intent = 'explanation';
      confidence = 0.8;
    }

    // Extract code-related entities
    const codeMatches = lowerTranscript.match(/\b(javascript|typescript|python|java|go|rust|react|node|function|class|component)\b/g);
    if (codeMatches) {
      codeMatches.forEach((match: string) => {
        entities.push({ type: 'technology', value: match });
      });
    }

    return {
      intent,
      confidence,
      entities,
    };
  },
});