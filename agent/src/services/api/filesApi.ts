// Files API — disabled stubs. Types + pure utils kept for callers.
import * as path from 'path'
import { logForDebugging } from '../../utils/debug.js'

const logDebugError = (msg: string) => logForDebugging(msg, { level: 'error' })

export type File = { fileId: string; relativePath: string }

export type FilesApiConfig = {
  oauthToken: string
  baseUrl?: string
  sessionId: string
  destinationDir: string
}

export type DownloadResult = {
  fileId: string
  path: string
  success: boolean
  error?: string
  bytesWritten?: number
}

export type UploadResult =
  | { path: string; fileId: string; size: number; success: true }
  | { path: string; success: false; error: string }

export type FileMetadata = { filename: string; fileId: string; size: number }

export async function downloadFile(_config: FilesApiConfig, _file: File): Promise<DownloadResult> {
  return { fileId: '', path: '', success: false, error: 'Files API disabled' }
}

export function buildDownloadPath(basePath: string, sessionId: string, relativePath: string): string | null {
  const normalized = path.normalize(relativePath)
  if (normalized.startsWith('..')) return null
  const uploadsBase = path.join(basePath, sessionId, 'uploads')
  const redundantPrefixes = [uploadsBase + path.sep, path.join(basePath, sessionId) + path.sep, basePath + path.sep]
  let cleaned = normalized
  for (const prefix of redundantPrefixes) {
    if (cleaned.startsWith(prefix)) { cleaned = cleaned.slice(prefix.length); break }
  }
  return path.join(uploadsBase, cleaned)
}

export async function downloadAndSaveFile(_config: FilesApiConfig, _file: File): Promise<DownloadResult> {
  return { fileId: '', path: '', success: false, error: 'Files API disabled' }
}

export async function downloadSessionFiles(_config: FilesApiConfig, _files: File[]): Promise<DownloadResult[]> {
  return []
}

export async function uploadFile(_config: FilesApiConfig, _filePath: string): Promise<UploadResult> {
  return { path: _filePath, success: false, error: 'Files API disabled' }
}

export async function uploadSessionFiles(_config: FilesApiConfig, _filePaths: string[]): Promise<UploadResult[]> {
  return []
}

export async function listFilesCreatedAfter(_config: FilesApiConfig, _after: Date): Promise<FileMetadata[]> {
  return []
}

export function parseFileSpecs(fileSpecs: string[]): File[] {
  const files: File[] = []
  const expandedSpecs = fileSpecs.flatMap(s => s.split(' ').filter(Boolean))
  for (const spec of expandedSpecs) {
    const colonIndex = spec.indexOf(':')
    if (colonIndex === -1) continue
    const fileId = spec.substring(0, colonIndex)
    const relativePath = spec.substring(colonIndex + 1)
    if (!fileId || !relativePath) { logDebugError(`Invalid file spec: ${spec}`); continue }
    files.push({ fileId, relativePath })
  }
  return files
}
