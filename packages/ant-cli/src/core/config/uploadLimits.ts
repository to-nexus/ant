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

/**
 * Whole-request byte budget.
 *
 * `fileSize` bounds ONE part. `files` bounds the count. Their product does not:
 * 50 files just under 50 MiB each is ~2.5 GiB of `Buffer` held in the process heap
 * before a single handler line runs, because `multer.memoryStorage()` keeps every
 * accepted part in `req.files` until parsing completes (M-007). This bounds the
 * request as a whole, well above any real upload (the largest legitimate case is a
 * single 50 MiB asset, or a folder drop of many small files).
 */
export const UPLOAD_REQUEST_MAX_BYTES = 200 * 1024 * 1024;

/**
 * Simultaneous multipart requests per account, cluster-wide.
 *
 * The byte budget bounds one request; without this, an account simply sends many.
 * Enforced through the Redis slot primitive so it holds across pods — a
 * process-local counter bounds one replica and the same account's requests land on
 * all of them.
 */
export const UPLOAD_MAX_INFLIGHT_PER_USER = 3;
