/**
 * Multipart upload budgets — SSOT.
 *
 * All three upload routers use `multer.memoryStorage()`, so every accepted part
 * is held in the process heap before any handler validation runs. A `fileSize`
 * cap alone bounds one part, not a request: N parts just below the cap multiply
 * (M-007). These bound the request as a whole.
 */
export const UPLOAD_LIMITS = {
  /** Per-file cap — unchanged; large design assets and GLBs are legitimate. */
  fileSize: 50 * 1024 * 1024,
  /** Files per request. Bulk artifact uploads sit far below this. */
  files: 50,
  /** Total multipart parts (files + fields) — backstop for field-only floods. */
  parts: 100,
  /** Non-file fields per request (`dirPath`, `relativePaths[]`, …). */
  fields: 50,
  /** Per-field value size — these carry paths and flags, never payloads. */
  fieldSize: 64 * 1024,
} as const;
