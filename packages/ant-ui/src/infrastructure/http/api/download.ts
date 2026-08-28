/**
 * Attachment download over the authenticated fetch path.
 *
 * A plain `window.open(url)` is a browser NAVIGATION: it authenticates only by
 * ambient cookie, and a refusal (413/429) renders as raw JSON in a new tab —
 * which is why the artifact folder download needs a preflight round-trip. These
 * archives are small and bounded server-side, so fetching them instead keeps the
 * error on THIS screen, as an ordinary rejected promise.
 *
 * The saved file name is built by the CALLER from an id it already holds; the
 * server's `Content-Disposition` is never parsed into `a.download`, so a header
 * can never decide what lands in the user's Downloads folder.
 */

import { authFetch, ApiError } from './client';

export async function downloadAttachment(url: string, fileName: string): Promise<void> {
  const response = await authFetch(url, { method: 'GET' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      (body as any).message || (body as any).error || `Download failed: ${response.statusText}`,
      response.status,
      body as Record<string, unknown>,
    );
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // The click has already handed the blob to the browser; revoking on the next
    // tick keeps the object URL from leaking for the tab's lifetime.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
