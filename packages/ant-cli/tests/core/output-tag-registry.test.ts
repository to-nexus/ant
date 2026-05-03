/**
 * OutputTagRegistry — Phase 1 invariants.
 *
 * Locks the SSOT shape:
 *   1. Every entry has well-formed axis (intent / processing /
 *      persistence / blocking) — `register()` already throws on shape
 *      violation, so importing the module without throwing is itself
 *      the strongest signal.
 *   2. `promptContract` non-empty for every entry.
 *   3. Hook presence ↔ processing axis (1:1).
 *   4. `chatLineKind` ↔ chat-line persistence (1:1).
 *   5. Existing SpecialTagTransformer / DecisionTagRegistry inventory
 *      is fully mirrored in the registry — Phase 1 SSOT migration must
 *      not lose tags silently.
 *
 * Phase 2 will add coverage for `<reply>`. Phase 4 will add lint that
 * the legacy wrapper functions are gone.
 */

import { describe, it, expect } from 'vitest';
import {
  allTags,
  allTagNames,
  findTag,
  getTag,
  tagsByIntent,
  stripRegisteredTags,
  transformAndStrip,
} from '../../src/core/streaming/OutputTagRegistry';
import { DECISION_TAG_REGISTRY } from '../../src/core/llm-response/DecisionTagRegistry';

describe('OutputTagRegistry — Phase 1 invariants', () => {
  it('loads without throwing (every register() call passed validateEntryShape)', () => {
    expect(allTags().length).toBeGreaterThan(0);
  });

  it('every entry has a non-empty promptContract', () => {
    for (const t of allTags()) {
      expect(t.promptContract.trim().length).toBeGreaterThan(0);
    }
  });

  it('hook presence matches processing axis (stream-action / consumed-formatted / post-stream / consumed-suppressed)', () => {
    for (const t of allTags()) {
      const hasStreamAction = t.axis.processing.includes('stream-action');
      const hasFormatted = t.axis.processing.includes('consumed-formatted');
      const hasPostStream = t.axis.processing.includes('post-stream');

      expect(Boolean(t.streamAction)).toBe(hasStreamAction);
      expect(Boolean(t.transform)).toBe(hasFormatted);
      expect(Boolean(t.extract)).toBe(hasPostStream);
    }
  });

  it('chatLineKind ↔ chat-line persistence is 1:1', () => {
    for (const t of allTags()) {
      const persists = t.axis.persistence.includes('chat-line');
      expect(Boolean(t.chatLineKind)).toBe(persists);
    }
  });

  it('axis intent uses one of the five canonical values', () => {
    const allowed = new Set([
      'artifact',
      'narrative',
      'control',
      'decision',
      'metadata',
    ]);
    for (const t of allTags()) {
      expect(allowed.has(t.axis.intent)).toBe(true);
    }
  });

  it('axis blocking uses one of the three canonical values', () => {
    const allowed = new Set(['blocking', 'terminal', 'non-blocking']);
    for (const t of allTags()) {
      expect(allowed.has(t.axis.blocking)).toBe(true);
    }
  });

  it('getTag throws on unknown name', () => {
    expect(() => getTag('definitely_not_a_real_tag')).toThrow(
      /unknown tag/,
    );
  });

  it('findTag returns undefined on unknown name', () => {
    expect(findTag('definitely_not_a_real_tag')).toBeUndefined();
  });
});

describe('OutputTagRegistry — Phase 1 inventory parity', () => {
  it('every tag SpecialTagTransformer historically owned is registered', () => {
    // Mirrors the inventory comment block at the top of
    // packages/ant-cli/src/core/streaming/transformers/SpecialTagTransformer.ts
    const expected = [
      'done',
      'learn_command',
      'tasks',
      'task',
      'references',
      'detect',
      'executionTier',
      'techTier',
      'boundary',
      'directHints',
      'specClarify',
      'domain',
      'gameArtTier',
      'gameContentTier',
    ];
    const names = new Set(allTagNames());
    for (const e of expected) {
      expect(names.has(e), `missing tag "${e}"`).toBe(true);
    }
  });

  it('every artifact-axis stream tag XMLStreamParser handles is registered', () => {
    const expected = ['file', 'append', 'edit', 'delete', 'plan'];
    const names = new Set(allTagNames());
    for (const e of expected) {
      expect(names.has(e), `missing artifact tag "${e}"`).toBe(true);
    }
  });

  it('control axis covers <done> and <clarify>', () => {
    const control = tagsByIntent('control').map((t) => t.name);
    expect(control).toContain('done');
    expect(control).toContain('clarify');
  });

  it('every DecisionTagRegistry entry has a corresponding registry entry under decision intent', () => {
    const decision = new Set(tagsByIntent('decision').map((t) => t.name));
    for (const def of DECISION_TAG_REGISTRY) {
      expect(
        decision.has(def.name),
        `decision tag "${def.name}" missing from OutputTagRegistry`,
      ).toBe(true);
    }
  });

  it('<reply> is the sole narrative-axis entry (Phase 2)', () => {
    const narrative = tagsByIntent('narrative').map((t) => t.name);
    expect(narrative).toEqual(['reply']);
  });

  it('<reply> body extraction returns trimmed inner content', () => {
    const reply = getTag('reply');
    const m = '<reply>\n  hello world  \n</reply>'.match(reply.pattern);
    expect(m).not.toBeNull();
    const out = reply.transform!(m!, { language: 'en' });
    expect(out.consumed).toBe(true);
    expect(out.text).toBe('hello world');
  });

  it('<reply> empty body consumes silently (no chat-line written)', () => {
    const reply = getTag('reply');
    const m = '<reply>   </reply>'.match(reply.pattern);
    expect(m).not.toBeNull();
    const out = reply.transform!(m!, { language: 'en' });
    expect(out.consumed).toBe(true);
    expect(out.text).toBeUndefined();
  });

  it('<reply> chatLineKind is directive_reply', () => {
    expect(getTag('reply').chatLineKind).toBe('directive_reply');
  });
});

describe('OutputTagRegistry — surface-side leak guards', () => {
  it('stripRegisteredTags removes a single <reply> block including body', () => {
    const out = stripRegisteredTags('before <reply>hello</reply> after');
    expect(out).toBe('before  after');
  });

  it('stripRegisteredTags removes multiple distinct tag families in one pass', () => {
    const input = 'a <reply>x</reply> b <done>true</done> c';
    expect(stripRegisteredTags(input)).toBe('a  b  c');
  });

  it('stripRegisteredTags is idempotent on tag-free input', () => {
    expect(stripRegisteredTags('plain markdown body')).toBe(
      'plain markdown body',
    );
  });

  it('stripRegisteredTags handles empty / undefined input safely', () => {
    expect(stripRegisteredTags('')).toBe('');
  });

  it('stripRegisteredTags removes case-variant tags', () => {
    expect(stripRegisteredTags('<REPLY>Body</REPLY>')).toBe('');
  });

  it('transformAndStrip renders <reply> body verbatim', () => {
    const out = transformAndStrip('<reply>hello world</reply>', 'en');
    expect(out).toBe('hello world');
  });

  it('transformAndStrip renders the locale-aware <done> message', () => {
    const out = transformAndStrip('<done>true</done>', 'en');
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toMatch(/<done>/);
  });

  it('transformAndStrip suppresses suppressed-axis tags (<techTier>, <boundary>, ...)', () => {
    const input = 'pre <techTier>{}</techTier> mid <boundary>x</boundary> post';
    const out = transformAndStrip(input, 'en');
    expect(out).toBe('pre  mid  post');
  });

  it('transformAndStrip preserves narrative body alongside surrounding text', () => {
    const out = transformAndStrip(
      'context <reply>answer</reply> trailer',
      'en',
    );
    expect(out).toBe('context answer trailer');
  });
});
