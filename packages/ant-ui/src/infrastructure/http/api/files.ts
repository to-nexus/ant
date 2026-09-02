import { API_BASE, authFetch, apiGet, apiPost, apiPut, apiPatch, apiDelete, ApiError, featureSeg } from './client';
import { isBinaryPath } from '@ant/shared';
import type { FileNode, FileResource, FileResourceMeta, TemplateReason } from '@ant/shared';

export type { FileNode, FileResource, FileResourceMeta, TemplateReason };

export interface UploadFileEntry {
  file: File;
  relativePath: string;
}

export interface UploadOptions {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

// ── Binary file helpers ─────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function isImageFilePath(filePath: string | undefined | null): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  const ext = lower.lastIndexOf('.') >= 0 ? lower.slice(lower.lastIndexOf('.')) : '';
  return IMAGE_EXTENSIONS.has(ext);
}

export function isSvgFilePath(filePath: string | undefined | null): boolean {
  if (!filePath) return false;
  return filePath.toLowerCase().endsWith('.svg');
}

export function isHtmlFilePath(filePath: string | undefined | null): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm');
}

/** Binary image files (non-text). SVG is excluded because it is text-editable. */
export function isBinaryImageFilePath(filePath: string | undefined | null): boolean {
  return isImageFilePath(filePath) && !isSvgFilePath(filePath);
}

/**
 * Any binary file (shared `BINARY_EXTENSIONS` SSOT — images, archives,
 * 3D models, audio, …). These must never be opened in the text editor:
 * the text file API refuses them (422 BINARY_FILE), and a text round-trip
 * would destroy the bytes. Images get the blob preview; everything else
 * gets the read-only binary info panel.
 */
export function isBinaryFilePath(filePath: string | undefined | null): boolean {
  if (!filePath) return false;
  return isBinaryPath(filePath);
}

/** Fetch raw file as Blob (binary-safe). Uses /files-raw/ endpoint. */
export async function fetchFileBlob(
  projectId: string,
  featureName: string,
  filePath: string,
): Promise<Blob> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/files-raw/${filePath}`;
  const response = await authFetch(url);
  if (!response.ok) throw new Error(`Failed to fetch file blob: ${response.statusText}`);
  return response.blob();
}

// ── CRUD operations ─────────────────────────────────────────────────

export function fetchFileTree(projectId: string, featureName: string, options?: { force?: boolean }): Promise<FileNode[]> {
  const query = options?.force ? '?force=true' : '';
  return apiGet(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/files${query}`,
  );
}

export function fetchFileContent(
  projectId: string,
  featureName: string,
  filePath: string,
): Promise<FileResource> {
  return apiGet(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/files/${filePath}`,
  );
}

export function saveFileContent(
  projectId: string,
  featureName: string,
  filePath: string,
  content: string,
): Promise<FileResource> {
  return apiPut(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/files/${filePath}`,
    { content },
  );
}

/** Create a new file. Semantic alias for saveFileContent with default empty content. */
export function createFile(
  projectId: string,
  featureName: string,
  filePath: string,
  content: string = '',
): Promise<FileResource> {
  return saveFileContent(projectId, featureName, filePath, content);
}

/** Upload files with progress tracking and cancel support. */
export async function uploadFiles(
  projectId: string,
  featureName: string,
  dirPath: string,
  files: FileList | UploadFileEntry[],
  options?: UploadOptions,
): Promise<{ uploadedFiles: string[]; count: number }> {
  const formData = new FormData();
  formData.append('dirPath', dirPath);

  const isEntryArray = Array.isArray(files) && files.length > 0 && 'relativePath' in files[0];

  if (isEntryArray) {
    const entries = files as UploadFileEntry[];
    entries.forEach((entry) => {
      formData.append('files', entry.file);
      formData.append('relativePaths', entry.relativePath);
    });
  } else {
    Array.from(files as FileList).forEach((file) => formData.append('files', file));
  }

  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/upload`;

  if (options?.onProgress || options?.signal) {
    return xhrUpload(url, formData, options);
  }

  const response = await authFetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new ApiError(
      (err as any).error || (err as any).message || `Failed to upload files: ${response.statusText}`,
      response.status,
      err,
    );
  }
  const data = await response.json();
  return { uploadedFiles: data?.uploadedFiles || [], count: data?.count || 0 };
}

function xhrUpload(
  url: string,
  formData: FormData,
  options: UploadOptions,
): Promise<{ uploadedFiles: string[]; count: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException('Upload cancelled', 'AbortError'));
        return;
      }
      options.signal.addEventListener('abort', () => {
        xhr.abort();
        reject(new DOMException('Upload cancelled', 'AbortError'));
      });
    }

    if (options.onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) options.onProgress!(e.loaded, e.total);
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve({ uploadedFiles: data?.uploadedFiles || [], count: data?.count || 0 });
        } catch {
          resolve({ uploadedFiles: [], count: 0 });
        }
      } else {
        let errorData: Record<string, unknown> = {};
        try { errorData = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        const message = (errorData.error as string) || (errorData.message as string) || `Upload failed: HTTP ${xhr.status}`;
        reject(new ApiError(message, xhr.status, errorData));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload network error')));

    xhr.open('POST', url);
    xhr.withCredentials = true; // Send JWT cookie for authentication
    xhr.send(formData);
  });
}

export function renameFileOrDirectory(
  projectId: string,
  featureName: string,
  oldPath: string,
  newPath: string,
): Promise<{ success: boolean; oldPath: string; newPath: string }> {
  return apiPatch(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/rename`,
    { oldPath, newPath },
  );
}

export function deleteFileOrDirectory(
  projectId: string,
  featureName: string,
  filePath: string,
): Promise<void> {
  return apiDelete(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/item`,
    { path: filePath },
  );
}

export function createDirectory(
  projectId: string,
  featureName: string,
  dirPath: string,
): Promise<void> {
  return apiPost(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/directory`,
    { path: dirPath },
  );
}

/** Where the ticketed workspace preview lane serves this file's directory. */
export interface FilePreviewTicket {
  ticket: string;
  expiresInSec: number;
  /**
   * ABSOLUTE `<base href>` for the preview document, decided by the server.
   *
   * The frontend deliberately computes no part of it. It used to pick between a
   * content-origin lane and the `files-raw` byte route from a build-time env
   * var, and since no cloud build ever set that var, every cloud user got the
   * byte route — whose contract is one path → one file, so a link to a folder
   * came back as `400 {"error":"Path is a directory, not a file"}`.
   */
  baseUrl: string;
  /** True only where a distinct content origin serves the lane. */
  allowScripts: boolean;
}

/**
 * Mint a short-lived ticket that lets the preview iframe browse this file's
 * feature root as a static site on the content origin.
 *
 * The ticket is the frame's only credential — the content listener has no
 * cookie — which is what lets the iframe drop `allow-same-origin`.
 */
export function mintFilePreviewTicket(
  projectId: string,
  featureName: string,
  filePath: string,
): Promise<FilePreviewTicket> {
  return apiPost(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/files-preview-ticket`,
    { path: filePath },
  );
}

export function getDownloadUrl(
  projectId: string,
  featureName: string,
  filePath: string,
): string {
  // Authentication via JWT cookie (credentials: 'include' on fetch, or same-origin browser navigation)
  return `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/download?path=${encodeURIComponent(filePath)}`;
}

/**
 * Ask whether a folder is within the ZIP download budget, before navigating to it.
 *
 * A folder download is a browser navigation, so a refusal body would render as raw
 * JSON in a new tab. This runs the same bounded walk the server would run anyway —
 * it builds no archive and holds no stream slot — so asking first costs little and
 * lets the UI show a real message.
 *
 * Resolves `null` when the download may proceed, or the `ApiError` to surface.
 */
export async function preflightDirectoryDownload(
  projectId: string,
  featureName: string,
  dirPath: string,
): Promise<ApiError | null> {
  const url = `${getDownloadUrl(projectId, featureName, dirPath)}&preflight=1`;
  try {
    const res = await authFetch(url, { method: 'GET' });
    if (res.ok || res.status === 204) return null;
    const body = await res.json().catch(() => ({}));
    return new ApiError(body.message ?? body.error ?? 'Download refused', res.status, body);
  } catch {
    // A transport failure here must not block the download attempt itself.
    return null;
  }
}
