import { memo } from 'react'

// File content interface (matches what might be in the content array)
interface FileContentItem {
  type: 'file'
  data?: string
  mimeType: string
  name: string
  size?: number
}

// Image content interface
interface ImageContentItem {
  type: 'image'
  data: string
  mimeType: string
}

// Generic content item type
type ContentItem = FileContentItem | ImageContentItem | { type: string; [key: string]: unknown }

// File type icons mapping
const FILE_TYPE_ICONS: Record<string, string> = {
  'application/pdf': 'picture_as_pdf',
  'text/plain': 'description',
  'text/markdown': 'description',
  'text/html': 'code',
  'text/css': 'code',
  'text/javascript': 'code',
  'application/javascript': 'code',
  'application/json': 'data_object',
  'application/typescript': 'code',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  'default': 'attach_file',
}

// File type labels
const FILE_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'text/html': 'HTML',
  'text/css': 'CSS',
  'text/javascript': 'JavaScript',
  'application/javascript': 'JavaScript',
  'application/json': 'JSON',
  'application/typescript': 'TypeScript',
  'image/png': 'PNG Image',
  'image/jpeg': 'JPEG Image',
  'image/gif': 'GIF Image',
  'image/webp': 'WebP Image',
  'image/svg+xml': 'SVG',
  'default': 'File',
}

// Format file size
function formatFileSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Get icon for file type
function getFileIcon(mimeType: string): string {
  return FILE_TYPE_ICONS[mimeType] || FILE_TYPE_ICONS['default']
}

// Get label for file type
function getFileLabel(mimeType: string): string {
  return FILE_TYPE_LABELS[mimeType] || FILE_TYPE_LABELS['default']
}

interface FileAttachmentItemProps {
  file: FileContentItem
  onPreview?: (file: FileContentItem) => void
}

const FileAttachmentItem = memo(function FileAttachmentItem({ file, onPreview }: FileAttachmentItemProps) {
  const icon = getFileIcon(file.mimeType)
  const label = getFileLabel(file.mimeType)
  const isImage = file.mimeType.startsWith('image/')

  const handleClick = () => {
    if (onPreview) {
      onPreview(file)
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`
        flex items-center gap-3 px-3 py-2 rounded-lg border border-border 
        bg-card hover:bg-muted/50 transition-colors cursor-pointer
        min-w-[200px] max-w-[300px]
      `}
    >
      {isImage && file.data ? (
        <img
          src={`data:${file.mimeType};base64,${file.data}`}
          alt={file.name}
          className="w-10 h-10 rounded object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="material-icon text-primary" style={{ fontSize: 20 }}>
            {icon}
          </span>
        </div>
      )}
      
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate font-secondary">
          {file.name}
        </p>
        <p className="text-xs text-muted-dim font-secondary">
          {label}{file.size ? ` • ${formatFileSize(file.size)}` : ''}
        </p>
      </div>
    </div>
  )
})

interface FileAttachmentsProps {
  content: ContentItem[]
  onPreviewFile?: (file: FileContentItem) => void
}

export const FileAttachments = memo(function FileAttachments({ content, onPreviewFile }: FileAttachmentsProps) {
  // Filter for file attachments (not images, just files)
  const fileAttachments = content.filter((c): c is FileContentItem => 
    c.type === 'file' && !c.mimeType.startsWith('image/')
  )

  if (fileAttachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {fileAttachments.map((file, index) => (
        <FileAttachmentItem
          key={`${file.name}-${index}`}
          file={file}
          onPreview={onPreviewFile}
        />
      ))}
    </div>
  )
})

// Image attachments component (separate from file attachments)
interface ImageAttachmentsProps {
  content: ContentItem[]
  maxWidth?: number
}

export const ImageAttachments = memo(function ImageAttachments({ content, maxWidth = 300 }: ImageAttachmentsProps) {
  const imageAttachments = content.filter((c): c is ImageContentItem => 
    c.type === 'image' || (c.type === 'file' && (c as FileContentItem).mimeType?.startsWith('image/'))
  )

  if (imageAttachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {imageAttachments.map((img, index) => (
        <div
          key={index}
          className="relative group rounded-lg overflow-hidden border border-border"
        >
          <img
            src={`data:${img.mimeType};base64,${img.data}`}
            alt="attachment"
            className="object-cover rounded-lg"
            style={{ maxWidth: `${maxWidth}px`, maxHeight: '200px' }}
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
        </div>
      ))}
    </div>
  )
})