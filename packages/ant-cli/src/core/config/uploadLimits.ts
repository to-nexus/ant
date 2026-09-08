/**
 * Multipart upload budgets — BE side.
 *
 * All three upload routers use `multer.memoryStorage()`, so every accepted part
 * is held in the process heap before any handler validation runs. A `fileSize`
 * cap alone bounds one part, not a request: N parts just below the cap multiply
 * (M-007). These bound the request as a whole.
 *
 * The caps a client must see and act on live in `@ant/shared/upload-limits` —
 * the FE batches folder uploads from the same `UPLOAD_MAX_FILES_PER_REQUEST`
 * this file's `files` cap enforces. The in-flight ceilings below stay here:
 * they bound a replica's heap and a cluster slot, which no client can observe.
 */
import {
  UPLOAD_FIELD_MAX_BYTES,
  UPLOAD_FILE_MAX_BYTES,
  UPLOAD_MAX_FILES_PER_REQUEST,
  UPLOAD_MAX_SCALAR_FIELDS,
} from '@ant/shared';

export { UPLOAD_REQUEST_MAX_BYTES } from '@ant/shared';

export const UPLOAD_LIMITS = {
  /** Per-file cap — large design assets and GLBs are legitimate. */
  fileSize: UPLOAD_FILE_MAX_BYTES,
  /** Files per request — the advertised count, and the FE's batch size. */
  files: UPLOAD_MAX_FILES_PER_REQUEST,
  /**
   * DERIVED, not chosen. Every lane pairs each file part with one
   * `relativePaths` field, so a `fields` cap picked independently of `files`
   * becomes the REAL file ceiling and the advertised one is unreachable:
   * `fields: 50` refused the 50th file with `LIMIT_FIELD_COUNT` at N=49, and a
   * 115-file folder drop died there. Derive both, so raising `files` cannot
   * silently leave the pairing under-budgeted again.
   *   fields = files + scalars      (one path field per file, plus dirPath/replaceDir/overwrite)
   *   parts  = files * 2 + scalars  (each file is a part AND carries a path field)
   */
  fields: UPLOAD_MAX_FILES_PER_REQUEST + UPLOAD_MAX_SCALAR_FIELDS,
  /** Total multipart parts (files + fields) — backstop for field-only floods. */
  parts: UPLOAD_MAX_FILES_PER_REQUEST * 2 + UPLOAD_MAX_SCALAR_FIELDS,
  /** Per-field value size — these carry paths and flags, never payloads. */
  fieldSize: UPLOAD_FIELD_MAX_BYTES,
} as const;

/**
 * Simultaneous multipart requests per account, cluster-wide.
 *
 * The byte budget bounds one request; without this, an account simply sends many.
 * Enforced through the Redis slot primitive so it holds across pods — a
 * process-local counter bounds one replica and the same account's requests land on
 * all of them.
 */
export const UPLOAD_MAX_INFLIGHT_PER_USER = 3;

/**
 * Pod-wide in-flight upload byte ceiling.
 *
 * The per-account slot + request budget bound ONE account, but `memoryStorage`
 * keeps every accepted part in heap, and nothing stopped many DIFFERENT accounts
 * from converging on one replica and summing to an OOM (M-007). This is a
 * process-local reservation across ALL accounts — no Redis dependency, so it is
 * always enforced (never fail-open) and bounds this replica's upload heap no
 * matter how the accounts are distributed. Sized for a healthy replica's heap;
 * well above the aggregate of a few concurrent legitimate uploads.
 */
export const UPLOAD_POD_MAX_INFLIGHT_BYTES = 512 * 1024 * 1024;

/**
 * Per-account share of the replica's in-flight upload bytes.
 *
 * The pod ceiling bounds the REPLICA; it does not divide it. One account may
 * hold `UPLOAD_MAX_INFLIGHT_PER_USER` requests at once, and a chunked body
 * (no declared length) reserves the whole request budget — so a single account
 * could reserve 3 × 200 MiB and push every other account on that replica into
 * 429 while staying inside its own documented allowance (L-033).
 *
 * Sized so that ONE maximum-size request always fits (never 429 a request the
 * per-request budget accepts) while no account can hold more than half the
 * replica. `UPLOAD_MAX_INFLIGHT_PER_USER` is unchanged: real uploads — a 50 MiB
 * asset, a folder drop of small files — sit far below this and are unaffected.
 */
export const UPLOAD_ACCOUNT_MAX_INFLIGHT_BYTES = 256 * 1024 * 1024;
