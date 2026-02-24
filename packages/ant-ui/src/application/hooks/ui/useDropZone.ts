import { useState, useCallback, useRef } from 'react';
import type { DragEvent } from 'react';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';

export interface UseDropZoneOptions {
  onDrop: (entries: UploadFileEntry[]) => void;
  disabled?: boolean;
}

export interface UseDropZoneReturn {
  isDragOver: boolean;
  dropProps: {
    onDragOver: (e: DragEvent) => void;
    onDragEnter: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

async function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readDirectoryEntries(
  dirEntry: FileSystemDirectoryEntry,
): Promise<FileSystemEntry[]> {
  const reader = dirEntry.createReader();
  const allEntries: FileSystemEntry[] = [];

  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

  // readEntries may return partial results; keep calling until empty
  let batch = await readBatch();
  while (batch.length > 0) {
    allEntries.push(...batch);
    batch = await readBatch();
  }

  return allEntries;
}

async function collectEntries(
  entry: FileSystemEntry,
  basePath: string,
  result: UploadFileEntry[],
): Promise<void> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntry);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    result.push({ file, relativePath });
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const children = await readDirectoryEntries(dirEntry);
    const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    for (const child of children) {
      await collectEntries(child, dirPath, result);
    }
  }
}

async function extractDroppedFiles(dataTransfer: DataTransfer): Promise<UploadFileEntry[]> {
  const items = dataTransfer.items;
  const entries: FileSystemEntry[] = [];

  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  if (entries.length === 0) {
    const files = Array.from(dataTransfer.files);
    return files.map((f) => ({ file: f, relativePath: f.name }));
  }

  const result: UploadFileEntry[] = [];
  for (const entry of entries) {
    await collectEntries(entry, '', result);
  }
  return result;
}

export function useDropZone({ onDrop, disabled }: UseDropZoneOptions): UseDropZoneReturn {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    },
    [disabled],
  );

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) setIsDragOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragOver(false);
      }
    },
    [disabled],
  );

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      const entries = await extractDroppedFiles(e.dataTransfer);
      if (entries.length > 0) onDrop(entries);
    },
    [disabled, onDrop],
  );

  return {
    isDragOver,
    dropProps: {
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
