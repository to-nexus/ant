/**
 * actionMetadataBudget — the single mint for size-validated action metadata
 * (M-NEW-029, byte axis).
 *
 * `actionMetadata` is deliberately open-shaped (`.passthrough()` at the HTTP
 * schema, so the RAC contract can evolve without a schema change), which means
 * a field-enumeration cap model can never bound it: an unknown field is by
 * definition outside that model. The closed model is one measurement of the
 * WHOLE serialized object against `ACTION_METADATA_MAX_SERIALIZED_BYTES`.
 *
 * Adoption is enforced in TYPE space, not by name greps — four audit rounds
 * proved name-keyed guards (literal paths, then call names, then variable
 * names) are re-spellable. `BoundedActionMetadata` is a branded type whose
 * brand symbol is private to this module: the only way to produce one is
 * `boundActionMetadata()`. Every internal consumer between an ingress and a
 * durable/broadcast/env sink requires the branded type, so a new ingress that
 * skips the mint fails to COMPILE.
 *
 * The three `any` trust boundaries a compile-time brand cannot see are each
 * paired with a runtime re-check calling this same mint:
 *   #0 HTTP `req.body`  — the shared zod schema `.transform()` mints here
 *   #1 env/queue replay — `job-runner` re-bounds after `JSON.parse`
 *   #2 pre-spawn        — `JobWorker` measures before `ANT_ACTION_METADATA`
 */

import { ACTION_METADATA_MAX_SERIALIZED_BYTES, type ActionMetadata } from '@ant/shared';

declare const BoundedActionMetadataBrand: unique symbol;

/**
 * An `ActionMetadata` whose serialized size has been checked by
 * `boundActionMetadata()` — the brand is required (not optional) and the
 * symbol is not exported, so neither an object literal, `satisfies`, nor a
 * structural assignment can fabricate one.
 */
export type BoundedActionMetadata = ActionMetadata & {
  readonly [BoundedActionMetadataBrand]: true;
};

export class ActionMetadataTooLargeError extends Error {
  readonly code = 'ACTION_METADATA_TOO_LARGE' as const;
  constructor(
    readonly serializedBytes: number,
    readonly limit: number,
  ) {
    super(
      `actionMetadata exceeds the serialized byte budget (${serializedBytes} > ${limit} bytes)`,
    );
    this.name = 'ActionMetadataTooLargeError';
  }
}

/**
 * Byte size of the value exactly as a durable line / env var would carry it.
 * An unserializable value (circular, or stringifies to nothing) measures as
 * Infinity — never admissible, so it fails the budget instead of the guard.
 */
export function measureActionMetadataBytes(meta: unknown): number {
  try {
    const text = JSON.stringify(meta);
    return text === undefined ? Number.POSITIVE_INFINITY : Buffer.byteLength(text, 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * The ONLY mint of `BoundedActionMetadata`. Measures once; throws a typed
 * error when over budget (or when the value cannot be serialized at all).
 * The cast below must stay the codebase's sole brand fabrication —
 * `tests/policy/contained-io-adoption.test.ts` pins that.
 */
export function boundActionMetadata(meta: ActionMetadata): BoundedActionMetadata;
export function boundActionMetadata(
  meta: ActionMetadata | undefined,
): BoundedActionMetadata | undefined;
export function boundActionMetadata(
  meta: ActionMetadata | undefined,
): BoundedActionMetadata | undefined {
  if (meta === undefined) return undefined;
  const bytes = measureActionMetadataBytes(meta);
  if (bytes > ACTION_METADATA_MAX_SERIALIZED_BYTES) {
    throw new ActionMetadataTooLargeError(bytes, ACTION_METADATA_MAX_SERIALIZED_BYTES);
  }
  return meta as BoundedActionMetadata;
}
