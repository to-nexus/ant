/**
 * Multipart upload budgets that cross BE↔FE.
 *
 * These four numbers had no shared home, and every consumer re-derived them:
 * the BE multer caps picked `fields`/`parts` independently of `files` (so the
 * advertised 50-file limit was unreachable — a paired `relativePaths` field per
 * file exhausted `fields` at 49), and the FE both batched nothing and hardcoded
 * `limitMb: 200` in a translation call. A 115-file folder therefore tripped
 * busboy's field cap and fell out as an untyped HTML 500.
 *
 * The FE batch size and the BE cap are now ONE constant, so neither side does
 * margin arithmetic. The three in-flight ceilings stay BE-only (they bound a
 * replica's heap and a cluster slot, which the client can neither see nor act
 * on) — see `packages/ant-cli/src/core/config/uploadLimits.ts`.
 */

/** Files per multipart request — the ADVERTISED count, and the FE batch size. */
export const UPLOAD_MAX_FILES_PER_REQUEST = 50;

/**
 * Non-file scalar fields a lane may carry, plus headroom.
 *
 * Today the widest lane sends one (`dirPath`, `replaceDir` or `overwrite`).
 * The slack exists so adding a second flag to a form cannot silently eat into
 * the per-file `relativePaths` budget the derived caps allocate.
 */
export const UPLOAD_MAX_SCALAR_FIELDS = 4;

/** Per-file cap — large design assets and GLBs are legitimate. */
export const UPLOAD_FILE_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Whole-request byte budget.
 *
 * `UPLOAD_FILE_MAX_BYTES` bounds ONE part and `UPLOAD_MAX_FILES_PER_REQUEST`
 * bounds the count; their product does not — 50 files just under 50 MiB each is
 * ~2.5 GiB of `Buffer` held in the process heap before a single handler line
 * runs, because `multer.memoryStorage()` keeps every accepted part in
 * `req.files` until parsing completes (M-007).
 */
export const UPLOAD_REQUEST_MAX_BYTES = 200 * 1024 * 1024;

/** Per-field value size — these carry paths and flags, never payloads. */
export const UPLOAD_FIELD_MAX_BYTES = 64 * 1024;

/** For the user-facing message — so no translation call hardcodes the number. */
export const UPLOAD_REQUEST_MAX_MB = UPLOAD_REQUEST_MAX_BYTES / (1024 * 1024);

/**
 * FE batch byte budget: the request budget minus worst-case multipart framing.
 *
 * A batch is sized by the bytes it will SEND, which is the sum of the file
 * sizes plus a part header per part. Reserving 1 KiB per part keeps a batch
 * that fits this budget inside `UPLOAD_REQUEST_MAX_BYTES` on the wire, so the
 * client never builds a request the server's own counter will abort.
 */
export const UPLOAD_BATCH_MAX_BYTES =
  UPLOAD_REQUEST_MAX_BYTES - (UPLOAD_MAX_FILES_PER_REQUEST * 2 + UPLOAD_MAX_SCALAR_FIELDS) * 1024;
