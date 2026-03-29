/**
 * File Operations Manager for Composio Tool Router
 * Handles file mount operations: list, upload, download, delete
 */

import { z } from "zod";
import path from "path";
import { ToolRouterConfig } from "./config";
import { FileMount } from "./tool-router";
import { ToolRouterError, FileMountError } from "./errors";

// ============================================================================
// Path Traversal Protection (SEC-004)
// ============================================================================

function safeResolve(basePath: string, userPath: string): string {
  const resolved = path.resolve(basePath, userPath);
  if (!resolved.startsWith(basePath)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

/** SEC-004: Sanitize filenames to prevent path traversal */
function sanitizeFileName(fileName: string): string {
  // Strip path components - only keep the basename
  const base = path.basename(fileName);
  // Reject empty or dot-only names
  if (!base || base === '.' || base === '..') {
    throw new Error('Invalid file name');
  }
  return base;
}

// ============================================================================
// Zod Schemas for API Responses
// ============================================================================

// Raw API response schemas (snake_case)
const ZFileMountEntryRaw = z.object({
  id: z.string(),
  url: z.string(),
  mime_type: z.string(),
  size: z.number(),
  name: z.string(),
  created_at: z.string().datetime(),
});

const ZFileListResponseRaw = z.object({
  files: z.array(ZFileMountEntryRaw),
  total: z.number(),
});

const ZPresignedUrlResponseRaw = z.object({
  url: z.string(),
  expires_at: z.string().datetime(),
  file_id: z.string(),
});

const ZMountRaw = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

const ZMountListResponseRaw = z.object({
  mounts: z.array(ZMountRaw),
  total: z.number(),
});

// Public schemas (camelCase for internal use)
export const ZFileMountEntry = z.object({
  id: z.string(),
  url: z.string(),
  mimeType: z.string(),
  size: z.number(),
  name: z.string(),
  createdAt: z.string().datetime(),
});

export const ZFileListResponse = z.object({
  files: z.array(ZFileMountEntry),
  total: z.number(),
});

export const ZPresignedUrlResponse = z.object({
  url: z.string(),
  expiresAt: z.string().datetime(),
  fileId: z.string(),
});

export const ZMount = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ZMountListResponse = z.object({
  mounts: z.array(ZMount),
  total: z.number(),
});

// ============================================================================
// TypeScript Types
// ============================================================================

export type FileMountEntry = z.infer<typeof ZFileMountEntry>;
export type FileListResponse = z.infer<typeof ZFileListResponse>;
export type PresignedUrlResponse = z.infer<typeof ZPresignedUrlResponse>;
export type Mount = z.infer<typeof ZMount>;
export type MountListResponse = z.infer<typeof ZMountListResponse>;

/**
 * Configuration for creating a new mount
 */
export interface CreateMountConfig {
  name: string;
  description?: string;
  maxFileSize?: number;
  allowedMimeTypes?: string[];
}

/**
 * Upload file configuration
 */
export interface UploadFileConfig {
  fileName: string;
  contentType: string;
  size?: number;
}

/**
 * Download file configuration
 */
export interface DownloadFileConfig {
  fileId: string;
  fileName?: string;
}

// ============================================================================
// FileOperationsManager Class
// ============================================================================

/**
 * FileOperationsManager handles file mount operations
 * - Mounts are per-session storage buckets
 * - Upload returns presigned URL for direct upload
 * - Download returns presigned URL for direct download
 */
export class FileOperationsManager {
  private config: ToolRouterConfig;

  constructor(config: ToolRouterConfig) {
    this.config = config;
  }

  // ============================================================================
  // Mount Management
  // ============================================================================

  /**
   * Create a new file mount for a session
   * @param sessionId - The session ID
   * @param config - Mount configuration
   * @returns The created mount
   */
  async createMount(
    sessionId: string,
    config: CreateMountConfig
  ): Promise<Mount> {
    console.log(
      `[FileOperationsManager] Creating mount "${config.name}" for session: ${sessionId}`
    );

    const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/mounts`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": this.config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: config.name,
        description: config.description,
        max_file_size: config.maxFileSize,
        allowed_mime_types: config.allowedMimeTypes,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ToolRouterError(
        `Failed to create mount: ${response.statusText} - ${errorText}`,
        "MOUNT_CREATION_FAILED",
        response.status
      );
    }

    const data = await response.json();
    const parsed = ZMountRaw.parse(data);
    return {
      id: parsed.id,
      name: parsed.name,
      description: parsed.description,
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
    };
  }

  /**
   * List all mounts for a session
   * @param sessionId - The session ID
   * @returns List of mounts
   */
  async listMounts(sessionId: string): Promise<Mount[]> {
    console.log(
      `[FileOperationsManager] Listing mounts for session: ${sessionId}`
    );

    const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/mounts`;

    const response = await fetch(url, {
      headers: {
        "x-api-key": this.config.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ToolRouterError(
        `Failed to list mounts: ${response.statusText} - ${errorText}`,
        "MOUNT_LIST_FAILED",
        response.status
      );
    }

    const data = await response.json();
    const parsed = ZMountListResponseRaw.parse(data);
    return parsed.mounts.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    }));
  }

  /**
   * Delete a mount and all its files
   * @param sessionId - The session ID
   * @param mountId - The mount ID to delete
   */
  async deleteMount(sessionId: string, mountId: string): Promise<void> {
    console.log(
      `[FileOperationsManager] Deleting mount ${mountId} for session: ${sessionId}`
    );

    const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/mounts/${mountId}`;

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "x-api-key": this.config.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ToolRouterError(
        `Failed to delete mount: ${response.statusText} - ${errorText}`,
        "MOUNT_DELETE_FAILED",
        response.status
      );
    }
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  /**
   * List files in a mount
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @returns List of files
   */
  async listFiles(
    sessionId: string,
    mountId: string
  ): Promise<FileMountEntry[]> {
    console.log(
      `[FileOperationsManager] Listing files in mount ${mountId} for session: ${sessionId}`
    );

    const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/mounts/${mountId}/files`;

    const response = await fetch(url, {
      headers: {
        "x-api-key": this.config.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ToolRouterError(
        `Failed to list files: ${response.statusText} - ${errorText}`,
        "FILE_LIST_FAILED",
        response.status
      );
    }

    const data = await response.json();
    const parsed = ZFileListResponseRaw.parse(data);
    return parsed.files.map((f) => ({
      id: f.id,
      url: f.url,
      mimeType: f.mime_type,
      size: f.size,
      name: f.name,
      createdAt: f.created_at,
    }));
  }

  /**
   * Get a presigned download URL for a file
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @param fileId - The file ID to download
   * @returns Presigned URL response
   */
  async getDownloadUrl(
    sessionId: string,
    mountId: string,
    fileId: string
  ): Promise<PresignedUrlResponse> {
    console.log(
      `[FileOperationsManager] Getting download URL for file ${fileId} in mount ${mountId}`
    );

    const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/mounts/${mountId}/files/${fileId}/download`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": this.config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new FileMountError(
          `File not found: ${fileId}`,
          fileId,
          "not_found"
        );
      }

      const errorText = await response.text();
      throw new ToolRouterError(
        `Failed to get download URL: ${response.statusText} - ${errorText}`,
        "DOWNLOAD_URL_FAILED",
        response.status
      );
    }

    const data = await response.json();
    const parsed = ZPresignedUrlResponseRaw.parse(data);
    return {
      url: parsed.url,
      expiresAt: parsed.expires_at,
      fileId: parsed.file_id,
    };
  }

  /**
   * Get a presigned upload URL for a file
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @param fileName - Name of the file to upload
   * @param contentType - MIME type of the file
   * @param size - Optional file size for validation
   * @returns Presigned URL response
   */
  async getUploadUrl(
    sessionId: string,
    mountId: string,
    fileName: string,
    contentType: string,
    size?: number
  ): Promise<PresignedUrlResponse> {
    fileName = sanitizeFileName(fileName);
    console.log(
      `[FileOperationsManager] Getting upload URL for file "${fileName}" (${contentType}) in mount ${mountId}`
    );

    const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/mounts/${mountId}/files/upload`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": this.config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file_name: fileName,
        content_type: contentType,
        size,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ToolRouterError(
        `Failed to get upload URL: ${response.statusText} - ${errorText}`,
        "UPLOAD_URL_FAILED",
        response.status
      );
    }

    const data = await response.json();
    const parsed = ZPresignedUrlResponseRaw.parse(data);
    return {
      url: parsed.url,
      expiresAt: parsed.expires_at,
      fileId: parsed.file_id,
    };
  }

  /**
   * Delete a file from a mount
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @param fileId - The file ID to delete
   */
  async deleteFile(
    sessionId: string,
    mountId: string,
    fileId: string
  ): Promise<void> {
    console.log(
      `[FileOperationsManager] Deleting file ${fileId} from mount ${mountId}`
    );

    const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/mounts/${mountId}/files/${fileId}`;

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "x-api-key": this.config.apiKey,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new FileMountError(
          `File not found: ${fileId}`,
          fileId,
          "not_found"
        );
      }

      const errorText = await response.text();
      throw new ToolRouterError(
        `Failed to delete file: ${response.statusText} - ${errorText}`,
        "FILE_DELETE_FAILED",
        response.status
      );
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Upload a file directly to a mount using the presigned URL
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @param fileName - Name of the file
   * @param content - File content as Buffer or Blob
   * @param contentType - MIME type of the file
   * @returns The file mount information
   */
  async uploadFile(
    sessionId: string,
    mountId: string,
    fileName: string,
    content: Buffer | Blob,
    contentType: string
  ): Promise<FileMountEntry> {
    fileName = sanitizeFileName(fileName);
    console.log(
      `[FileOperationsManager] Uploading file "${fileName}" to mount ${mountId}`
    );

    // Get presigned upload URL
    const size = content instanceof Buffer ? content.length : (content as Blob).size;
    const presignedResponse = await this.getUploadUrl(
      sessionId,
      mountId,
      fileName,
      contentType,
      size
    );

    // Upload to presigned URL
    let uploadBody: ArrayBuffer | Blob;
    if (content instanceof Buffer) {
      const buffer = content as Buffer;
      uploadBody = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer;
    } else {
      uploadBody = content as Blob;
    }

    const uploadResponse = await fetch(presignedResponse.url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      body: uploadBody,
    });

    if (!uploadResponse.ok) {
      throw new FileMountError(
        `Failed to upload file: ${uploadResponse.statusText}`,
        fileName,
        "upload_failed"
      );
    }

    // Get the file info from the response or fetch it
    return {
      id: presignedResponse.fileId,
      url: presignedResponse.url,
      mimeType: contentType,
      size: size || 0,
      name: fileName,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Download a file from a mount
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @param fileId - The file ID to download
   * @returns File content as ArrayBuffer
   */
  async downloadFile(
    sessionId: string,
    mountId: string,
    fileId: string
  ): Promise<{ content: ArrayBuffer; contentType: string; fileName: string }> {
    console.log(
      `[FileOperationsManager] Downloading file ${fileId} from mount ${mountId}`
    );

    // Get presigned download URL
    const presignedResponse = await this.getDownloadUrl(
      sessionId,
      mountId,
      fileId
    );

    // Download from presigned URL
    const response = await fetch(presignedResponse.url);

    if (!response.ok) {
      throw new FileMountError(
        `Failed to download file: ${response.statusText}`,
        fileId,
        "not_found"
      );
    }

    const content = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const contentDisposition = response.headers.get("content-disposition");
    let fileName = fileId;

    // Extract filename from Content-Disposition header if available
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) {
        fileName = match[1];
      }
    }

    return { content, contentType, fileName };
  }

  /**
   * Get file information
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @param fileId - The file ID
   * @returns File information
   */
  async getFileInfo(
    sessionId: string,
    mountId: string,
    fileId: string
  ): Promise<FileMountEntry> {
    const files = await this.listFiles(sessionId, mountId);
    const file = files.find((f) => f.id === fileId);

    if (!file) {
      throw new FileMountError(
        `File not found: ${fileId}`,
        fileId,
        "not_found"
      );
    }

    return file;
  }

  /**
   * Check if a file exists in a mount
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @param fileId - The file ID to check
   * @returns True if file exists
   */
  async fileExists(
    sessionId: string,
    mountId: string,
    fileId: string
  ): Promise<boolean> {
    try {
      await this.getFileInfo(sessionId, mountId, fileId);
      return true;
    } catch (error) {
      if (error instanceof FileMountError && error.reason === "not_found") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Copy a file between mounts
   * @param sessionId - The session ID
   * @param sourceMountId - Source mount ID
   * @param sourceFileId - Source file ID
   * @param targetMountId - Target mount ID
   * @param targetFileName - Optional target file name
   * @returns The new file entry
   */
  async copyFile(
    sessionId: string,
    sourceMountId: string,
    sourceFileId: string,
    targetMountId: string,
    targetFileName?: string
  ): Promise<FileMountEntry> {
    console.log(
      `[FileOperationsManager] Copying file ${sourceFileId} from mount ${sourceMountId} to mount ${targetMountId}`
    );

    // Download from source
    const { content, contentType, fileName } = await this.downloadFile(
      sessionId,
      sourceMountId,
      sourceFileId
    );

    // Upload to target
    const finalFileName = targetFileName || fileName;
    return this.uploadFile(
      sessionId,
      targetMountId,
      finalFileName,
      Buffer.from(content),
      contentType
    );
  }

  /**
   * Move a file between mounts (copy then delete)
   * @param sessionId - The session ID
   * @param sourceMountId - Source mount ID
   * @param sourceFileId - Source file ID
   * @param targetMountId - Target mount ID
   * @param targetFileName - Optional target file name
   * @returns The new file entry
   */
  async moveFile(
    sessionId: string,
    sourceMountId: string,
    sourceFileId: string,
    targetMountId: string,
    targetFileName?: string
  ): Promise<FileMountEntry> {
    console.log(
      `[FileOperationsManager] Moving file ${sourceFileId} from mount ${sourceMountId} to mount ${targetMountId}`
    );

    // Copy to target
    const newFile = await this.copyFile(
      sessionId,
      sourceMountId,
      sourceFileId,
      targetMountId,
      targetFileName
    );

    // Delete from source
    await this.deleteFile(sessionId, sourceMountId, sourceFileId);

    return newFile;
  }
}
