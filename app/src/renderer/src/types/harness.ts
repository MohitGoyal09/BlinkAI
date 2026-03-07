// Re-export canonical types from @mastra/core/harness (type-only, zero runtime cost)
export type {
  HarnessEvent,
  HarnessMessage,
  HarnessMessageContent,
  HarnessSession,
  HarnessThread,
  TokenUsage,
  AvailableModel,
  PermissionPolicy,
  PermissionRules,
  ToolCategory,
} from '@mastra/core/harness'

export interface TaskItem {
  status: 'completed' | 'in_progress' | 'pending'
  content: string
  activeForm?: string
}

// Extract specific event types for consumers
import type { HarnessEvent } from '@mastra/core/harness'
export type ToolStartEvent = Extract<HarnessEvent, { type: 'tool_start' }>
export type ToolEndEvent = Extract<HarnessEvent, { type: 'tool_end' }>
export type ToolApprovalEvent = Extract<HarnessEvent, { type: 'tool_approval_required' }>
export type ShellOutputEvent = Extract<HarnessEvent, { type: 'shell_output' }>
export type AskQuestionEvent = Extract<HarnessEvent, { type: 'ask_question' }>
export type PlanApprovalEvent = Extract<HarnessEvent, { type: 'plan_approval_required' }>

// UI state types (not in @mastra/core — these track live rendering state)
export type ToolStatus = 'running' | 'approval_required' | 'approval_responded' | 'completed' | 'error'

export interface ToolState {
  toolCallId: string
  toolName: string
  args: unknown
  status: ToolStatus
  result?: unknown
  partialResult?: unknown
  isError?: boolean
  shellOutput?: string
}

export interface SubagentState {
  toolCallId: string
  agentType: string
  task: string
  modelId: string
  status: 'running' | 'completed' | 'error'
  text: string
  result?: string
  isError?: boolean
  durationMs?: number
  nestedTools: SubagentToolState[]
}

export interface SubagentToolState {
  toolName: string
  args: unknown
  result?: unknown
  isError?: boolean
  status: 'running' | 'completed' | 'error'
}

// File staging type (replaces AI SDK's FileUIPart)
export interface StagedFile {
  type: 'file'
  url: string // data URL for preview
  mediaType: string
  filename?: string
}

/** Map file extensions to MIME types for when the browser can't detect them */
const EXT_TO_MIME: Record<string, string> = {
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  rtf: 'application/rtf',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  // Code files
  js: 'application/javascript',
  ts: 'application/typescript',
  jsx: 'application/javascript',
  tsx: 'application/typescript',
  html: 'text/html',
  css: 'text/css',
  scss: 'text/scss',
  sass: 'text/sass',
  less: 'text/less',
  py: 'text/x-python',
  java: 'text/x-java',
  go: 'text/x-go',
  rs: 'text/x-rust',
  c: 'text/x-c',
  cpp: 'text/x-c++',
  h: 'text/x-c-header',
  hpp: 'text/x-c++-header',
  php: 'text/x-php',
  rb: 'text/x-ruby',
  swift: 'text/x-swift',
  kt: 'text/x-kotlin',
  sql: 'application/sql',
  sh: 'application/x-sh',
  bash: 'application/x-sh',
  zsh: 'application/x-sh',
  ps1: 'application/x-powershell',
  // Archives
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  bz2: 'application/x-bzip2',
  '7z': 'application/x-7z-compressed',
  rar: 'application/x-rar-compressed',
  // Media
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
}

/** Detect MIME type from file, falling back to extension-based detection */
function detectMimeType(file: File): string {
  // If browser provides a type, use it
  if (file.type && file.type !== 'application/octet-stream') {
    return file.type
  }

  // Otherwise, try to detect from extension
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext && EXT_TO_MIME[ext]) {
    return EXT_TO_MIME[ext]
  }

  // Final fallback (LLMs like Gemini reject octet-stream)
  return 'text/plain'
}

/** Convert a FileList to StagedFile array (replaces AI SDK's convertFileListToFileUIParts) */
export async function convertFilesToStagedFiles(files: FileList): Promise<StagedFile[]> {
  const results: StagedFile[] = []
  for (const file of Array.from(files)) {
    const detectedMimeType = detectMimeType(file)
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        let dataUrl = reader.result as string
        // Fix the MIME type in the data URL if browser got it wrong
        // Data URLs look like: data:[MIME];base64,[DATA]
        if (detectedMimeType && dataUrl.startsWith('data:')) {
          const commaIndex = dataUrl.indexOf(',')
          const semicolonIndex = dataUrl.indexOf(';')
          if (commaIndex > 0 && semicolonIndex > 0 && semicolonIndex < commaIndex) {
            const currentMime = dataUrl.slice(5, semicolonIndex) // Remove 'data:' prefix
            if (currentMime !== detectedMimeType) {
              // Replace the MIME type in the data URL
              dataUrl = `data:${detectedMimeType};base64,${dataUrl.slice(commaIndex + 1)}`
            }
          }
        }
        resolve(dataUrl)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    results.push({ type: 'file', url, mediaType: detectedMimeType, filename: file.name })
  }
  return results
}
