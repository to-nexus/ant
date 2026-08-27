/**
 * boundActionMetadata — the single mint of `BoundedActionMetadata` (M-NEW-029).
 * One measurement of the whole serialized object; typed refusal over budget.
 */

import { describe, it, expect } from 'vitest';
import { ACTION_METADATA_MAX_SERIALIZED_BYTES } from '@ant/shared';
import {
  ActionMetadataTooLargeError,
  boundActionMetadata,
  measureActionMetadataBytes,
} from '../../../src/core/context/actionMetadataBudget';

describe('boundActionMetadata', () => {
  it('undefined passes through (optional metadata stays optional)', () => {
    expect(boundActionMetadata(undefined)).toBeUndefined();
  });

  it('accepts exactly at the budget (boundary is inclusive)', () => {
    const skeleton = measureActionMetadataBytes({ pad: '' });
    const meta = { pad: 'x'.repeat(ACTION_METADATA_MAX_SERIALIZED_BYTES - skeleton) } as any;
    expect(measureActionMetadataBytes(meta)).toBe(ACTION_METADATA_MAX_SERIALIZED_BYTES);
    expect(boundActionMetadata(meta)).toBe(meta);
  });

  it('rejects one byte over with the typed error carrying size and limit', () => {
    const skeleton = measureActionMetadataBytes({ pad: '' });
    const meta = { pad: 'x'.repeat(ACTION_METADATA_MAX_SERIALIZED_BYTES - skeleton + 1) } as any;
    let thrown: unknown;
    try {
      boundActionMetadata(meta);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ActionMetadataTooLargeError);
    const e = thrown as ActionMetadataTooLargeError;
    expect(e.code).toBe('ACTION_METADATA_TOO_LARGE');
    expect(e.serializedBytes).toBe(ACTION_METADATA_MAX_SERIALIZED_BYTES + 1);
    expect(e.limit).toBe(ACTION_METADATA_MAX_SERIALIZED_BYTES);
  });

  it('measures multi-byte characters as bytes, not chars', () => {
    // A CJK char is 3 UTF-8 bytes; a char-count model would under-measure 3×.
    expect(measureActionMetadataBytes({ k: '한' })).toBe(Buffer.byteLength('{"k":"한"}', 'utf8'));
  });

  it('an unserializable value fails the budget instead of escaping the guard', () => {
    const circular: any = {};
    circular.self = circular;
    expect(() => boundActionMetadata(circular)).toThrow(ActionMetadataTooLargeError);
  });
});
