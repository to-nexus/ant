import { API_BASE, authFetch, apiGet, apiPost, apiPut, apiDelete } from './client';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export interface FileContent {
  path: string;
  content: string;
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

/** Binary image files (non-text). SVG is excluded because it is text-editable. */
export function isBinaryImageFilePath(filePath: string | undefined | null): boolean {
  return isImageFilePath(filePath) && !isSvgFilePath(filePath);
}

/** Fetch raw file as Blob (binary-safe). Uses /files-raw/ endpoint. */
export async function fetchFileBlob(
  projectId: string,
  featureName: string,
  filePath: string,
): Promise<Blob> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files-raw/${filePath}`;
  const response = await authFetch(url);
  if (!response.ok) throw new Error(`Failed to fetch file blob: ${response.statusText}`);
  return response.blob();
}

// ── CRUD operations ─────────────────────────────────────────────────

export function fetchFileTree(projectId: string, featureName: string): Promise<FileNode[]> {
  return apiGet(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files`,
  );
}

export function fetchFileContent(
  projectId: string,
  featureName: string,
  filePath: string,
): Promise<FileContent> {
  return apiGet(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files/${filePath}`,
  );
}

export function saveFileContent(
  projectId: string,
  featureName: string,
  filePath: string,
  content: string,
): Promise<void> {
  return apiPut(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files/${filePath}`,
    { content },
  );
}

/** Create a new file. Semantic alias for saveFileContent with default empty content. */
export function createFile(
  projectId: string,
  featureName: string,
  filePath: string,
  content: string = '',
): Promise<void> {
  return saveFileContent(projectId, featureName, filePath, content);
}

/** Upload files (using FormData for binary). */
export async function uploadFiles(
  projectId: string,
  featureName: string,
  dirPath: string,
  files: FileList,
): Promise<{ uploadedFiles: string[]; count: number }> {
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append('files', file));
  formData.append('dirPath', dirPath);

  const response = await authFetch(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/upload`,
    { method: 'POST', body: formData },
  );

  if (!response.ok) throw new Error(`Failed to upload files: ${response.statusText}`);
  const data = await response.json();
  return { uploadedFiles: data?.uploadedFiles || [], count: data?.count || 0 };
}

export function deleteFileOrDirectory(
  projectId: string,
  featureName: string,
  filePath: string,
): Promise<void> {
  return apiDelete(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/item`,
    { path: filePath },
  );
}

export function createDirectory(
  projectId: string,
  featureName: string,
  dirPath: string,
): Promise<void> {
  return apiPost(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/directory`,
    { path: dirPath },
  );
}

export function getDownloadUrl(
  projectId: string,
  featureName: string,
  filePath: string,
): string {
  return `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/download?path=${encodeURIComponent(filePath)}`;
}
