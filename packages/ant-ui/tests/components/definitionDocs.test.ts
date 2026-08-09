/**
 * Definition-document algebra — the raw ⇄ structured axis the Agent Settings
 * cards run on. One row per direction: structured edit lands in the raw text
 * (comments intact), a raw edit lands in the derived form, a syntax error is
 * reported instead of thrown, and a freshly added intent is invalid until its
 * criteria are authored (the save gate).
 */

import { describe, it, expect } from 'vitest';
import { validateMcpServers } from '@ant/shared';
import {
  applyIntentsDraft,
  applyMainDraft,
  applyMcpServers,
  applyName,
  deriveIntents,
  deriveMainDraft,
  deriveMcpServers,
  deriveName,
  editRaw,
  parseYamlDoc,
  validateIntentsDraft,
} from '../../src/presentation/components/AgentSettings/overview/definitionDocs';

const JOB_YAML = `# the weekly report job
id: weekly
name: Weekly report
tools:
  builtin: [read_file, write_file]
  approval:
    run_command: never
mcp:
  servers:
    figma:
      transport: stdio
      command: figma-mcp
`;

const INTENTS_YAML = `# weekly's classification lanes
version: 1
intents:
  - id: research
    description: fact-finding requests
    injections: [style.md]
  - id: triage
    description: incident reports
`;

const docOf = (raw: string) => parseYamlDoc(raw).doc;

describe('raw → structured derivation', () => {
  it('reads identity, tools and mcp servers off job.yaml', () => {
    const doc = docOf(JOB_YAML);
    expect(deriveName(doc)).toBe('Weekly report');
    expect(deriveMainDraft(doc)).toEqual({
      toolsBuiltin: ['read_file', 'write_file'],
      approval: { run_command: 'never' },
    });
    expect(deriveMcpServers(doc)).toEqual({ figma: { transport: 'stdio', command: 'figma-mcp' } });
  });

  it('absent tools.builtin derives null (= inherit the whole preset)', () => {
    expect(deriveMainDraft(docOf('id: weekly\nname: Weekly\n'))).toEqual({
      toolsBuiltin: null,
      approval: {},
    });
  });

  it('reads the intent catalog, injections included', () => {
    expect(deriveIntents(docOf(INTENTS_YAML))).toEqual([
      { id: 'research', description: 'fact-finding requests', injections: ['style.md'] },
      { id: 'triage', description: 'incident reports' },
    ]);
  });

  it('an absent intents.yaml (empty buffer) derives an empty catalog', () => {
    expect(deriveIntents(docOf(''))).toEqual([]);
  });
});

describe('structured → raw application', () => {
  it('renaming rewrites only the name and keeps comments', () => {
    const next = editRaw(JOB_YAML, (doc) => applyName(doc, 'Weekly digest'));
    expect(next).toContain('name: Weekly digest');
    expect(next).toContain('# the weekly report job');
    expect(deriveName(docOf(next))).toBe('Weekly digest');
  });

  it('a full tool selection removes the key rather than listing everything', () => {
    const next = editRaw(JOB_YAML, (doc) =>
      applyMainDraft(doc, { toolsBuiltin: null, approval: { run_command: 'never' } }),
    );
    expect(next).not.toContain('builtin:');
    expect(deriveMainDraft(docOf(next)).approval).toEqual({ run_command: 'never' });
  });

  it('dropping every approval override removes the empty tools map entirely', () => {
    const next = editRaw(JOB_YAML, (doc) => applyMainDraft(doc, { toolsBuiltin: null, approval: {} }));
    expect(next).not.toContain('tools:');
  });

  // The `intents` node is replaced wholesale, so only comments outside it survive.
  /**
   * A nested set/delete over an absent or scalar key throws inside `yaml`
   * ("Expected YAML collection at tools") — the scaffolded id/name/version
   * file and a key left empty under a comment are both that shape, so every
   * first edit on a fresh job used to crash the screen.
   */
  it.each([
    ['scaffolded file with no tools key', 'id: weekly\nname: W\nversion: 1\n'],
    ['tools left empty under a comment', 'id: weekly\nname: W\ntools:\n  # nothing yet\n'],
    ['tools holding a scalar', 'id: weekly\nname: W\ntools: none\n'],
  ])('first approval override on a %s', (_label, raw) => {
    const next = editRaw(raw, (doc) =>
      applyMainDraft(doc, { toolsBuiltin: null, approval: { run_command: 'never' } }),
    );
    expect(deriveMainDraft(docOf(next))).toEqual({
      toolsBuiltin: null,
      approval: { run_command: 'never' },
    });
  });

  it.each([
    ['no mcp key', 'id: weekly\nname: W\n'],
    ['mcp left empty under a comment', 'id: weekly\nname: W\nmcp:\n  # later\n'],
  ])('first mcp server on a file with %s', (_label, raw) => {
    const next = editRaw(raw, (doc) =>
      applyMcpServers(doc, { db: { transport: 'stdio', command: 'npx' } }),
    );
    expect(deriveMcpServers(docOf(next))).toEqual({ db: { transport: 'stdio', command: 'npx' } });
  });

  it('clearing servers on a file that never had an mcp key is a no-op', () => {
    const raw = 'id: weekly\nname: W\n';
    expect(editRaw(raw, (doc) => applyMcpServers(doc, {}))).toBe(raw);
  });

  it('intent edits round-trip through the catalog and keep the document comment', () => {
    const next = editRaw(INTENTS_YAML, (doc) =>
      applyIntentsDraft(
        doc,
        deriveIntents(doc).map((e) => (e.id === 'triage' ? { ...e, description: 'paging alerts' } : e)),
      ),
    );
    expect(next).toContain("# weekly's classification lanes");
    expect(deriveIntents(docOf(next))).toEqual([
      { id: 'research', description: 'fact-finding requests', injections: ['style.md'] },
      { id: 'triage', description: 'paging alerts' },
    ]);
  });

  it('writes version 1 into a previously absent intents.yaml', () => {
    const next = editRaw('', (doc) => applyIntentsDraft(doc, [{ id: 'triage', description: 'alerts' }]));
    expect(next).toContain('version: 1');
    expect(deriveIntents(docOf(next))).toEqual([{ id: 'triage', description: 'alerts' }]);
  });
});

describe('mcp.servers round-trip', () => {
  it('a stdio server survives derive → apply unchanged', () => {
    const servers = {
      'ops-db': {
        transport: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@acme/ops-db-mcp'],
        env: { DB_URL: 'OPS_DB_URL' },
      },
    };
    const next = editRaw(JOB_YAML, (doc) => applyMcpServers(doc, servers));
    expect(deriveMcpServers(docOf(next))).toEqual(servers);
    expect(next).toContain('# the weekly report job');
  });

  it('http keeps only url — the fields the runtime ignores are not written', () => {
    const next = editRaw(JOB_YAML, (doc) =>
      applyMcpServers(doc, {
        remote: { transport: 'http', url: 'https://mcp.example/sse', command: 'ignored', args: ['x'] },
      }),
    );
    expect(deriveMcpServers(docOf(next))).toEqual({
      remote: { transport: 'http', url: 'https://mcp.example/sse' },
    });
  });

  it('removing the last server drops the whole mcp block', () => {
    const next = editRaw(JOB_YAML, (doc) => applyMcpServers(doc, {}));
    expect(next).not.toContain('mcp:');
    expect(deriveMcpServers(docOf(next))).toEqual({});
  });

  it('an unsupported transport is kept verbatim so the validator can see it', () => {
    const raw = 'id: weekly\nname: W\nmcp:\n  servers:\n    x:\n      transport: sse\n';
    const derived = deriveMcpServers(docOf(raw));
    expect(derived.x.transport).toBe('sse');
    expect(validateMcpServers(derived).join('\n')).toMatch(/transport must be/);
  });

  it('a lowercase env value is refused — env names a host variable, not a secret', () => {
    const errors = validateMcpServers({
      db: { transport: 'stdio', command: 'npx', env: { DB_URL: 'postgres://secret' } },
    });
    expect(errors.join('\n')).toMatch(/host env var NAME/);
  });
});

describe('syntax errors are reported, never thrown', () => {
  it('parseYamlDoc returns the message and no document', () => {
    const { doc, error } = parseYamlDoc('id: [broken\n');
    expect(doc).toBeNull();
    expect(error).toBeTruthy();
  });

  it('editRaw leaves an unparseable buffer byte-for-byte untouched', () => {
    const broken = 'id: [broken\n';
    expect(editRaw(broken, (doc) => applyName(doc, 'x'))).toBe(broken);
  });
});

describe('intent catalog contract (client mirror of the BE gate)', () => {
  const cases: Array<[string, Parameters<typeof validateIntentsDraft>[0], RegExp | null]> = [
    ['valid entry', [{ id: 'triage', description: 'alerts' }], null],
    ['freshly added intent has no criteria yet', [{ id: 'triage', description: '' }], /requires a description/],
    ['id must be kebab-lowercase', [{ id: 'Triage', description: 'alerts' }], /must match/],
    ['general is the implicit fallback', [{ id: 'general', description: 'anything' }], /cannot be declared/],
    [
      'duplicate ids',
      [
        { id: 'triage', description: 'a' },
        { id: 'triage', description: 'b' },
      ],
      /duplicate/,
    ],
    ['description cap', [{ id: 'triage', description: 'x'.repeat(201) }], /exceeds 200/],
  ];

  it.each(cases)('%s', (_label, entries, expected) => {
    const errors = validateIntentsDraft(entries);
    if (expected === null) expect(errors).toEqual([]);
    else expect(errors.join('\n')).toMatch(expected);
  });

  it('caps the catalog at 32 entries', () => {
    const many = Array.from({ length: 33 }, (_, i) => ({ id: `intent-${i}`, description: 'x' }));
    expect(validateIntentsDraft(many).join('\n')).toMatch(/cap of 32/);
  });
});
