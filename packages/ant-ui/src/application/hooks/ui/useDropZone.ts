import type { UploadFileEntry } from '@/infrastructure/http/api/files';

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

export async function extractDroppedFiles(dataTransfer: DataTransfer): Promise<UploadFileEntry[]> {
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
