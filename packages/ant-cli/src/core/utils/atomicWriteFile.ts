import * as fs from 'fs';
import * as path from 'path';

/**
 * Atomic file write: write to a sibling temp file then rename over the target.
 *
 * Prevents partial/corrupt JSON when the process crashes or is killed mid-write.
 * The rename operation is atomic on POSIX systems when `src` and `dest` are on
 * the same filesystem.
 *
 * Canonical implementation — prefer this over ad-hoc temp+rename dances in
 * individual modules (previously duplicated in JobCleanupManager / sessionCleanup).
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    await fs.promises.writeFile(tmpPath, content, 'utf-8');
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
