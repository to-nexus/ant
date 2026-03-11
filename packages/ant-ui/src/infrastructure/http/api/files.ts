import { API_BASE, authFetch, apiGet, apiPost, apiPut, apiPatch, apiDelete } from './client';

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

export function fetchFileTree(projectId: string, featureName: string, options?: { force?: boolean }): Promise<FileNode[]> {
  const query = options?.force ? '?force=true' : '';
  return apiGet(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files${query}`,
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

  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/upload`;

  if (options?.onProgress || options?.signal) {
    return xhrUpload(url, formData, options);
  }

  const response = await authFetch(url, { method: 'POST', body: formData });
  if (!response.ok) throw new Error(`Failed to upload files: ${response.statusText}`);
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
        reject(new Error(`Upload failed: HTTP ${xhr.status}`));
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
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/rename`,
    { oldPath, newPath },
  );
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
  // Authentication via JWT cookie (credentials: 'include' on fetch, or same-origin browser navigation)
  return `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/download?path=${encodeURIComponent(filePath)}`;
}
