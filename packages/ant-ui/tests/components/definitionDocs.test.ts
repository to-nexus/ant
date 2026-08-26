/**
 * Definition-document algebra — the raw ⇄ structured axis the Agent Settings
 * cards run on. One row per direction: structured edit lands in the raw text
 * (comments intact), a raw edit lands in the derived form, a syntax error is
 * reported instead of thrown, and a freshly added intent is invalid until its
 * criterion is authored (the save gate). The infer.md rows pin the shared
 * frontmatter fence contract (splitFrontmatter — BE and FE parse the same
 * bytes the same way).
 */

import { describe, it, expect } from 'vitest';
import { validateMcpServers, validateApiServers } from '@ant/shared';
import {
  CARD_OF_KIND,
  DEFINITION_DIR_KINDS,
  applyHooks,
  applyInferBody,
  applyInferClarify,
  applyMainDraft,
  applyMcpServers,
  applyApiServers,
  applyName,
  classifyDefinitionPath,
  deriveHooks,
  deriveMainDraft,
  deriveMcpServers,
  deriveApiServers,
  deriveName,
  editRaw,
  parseInferMd,
  parseYamlDoc,
  planSaves,
  validateHooksDoc,
  validateInferDoc,
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

// One infer.md carrying frontmatter guidance comments plus the clarify flag —
// comments must survive every structured edit, and guidance inside the fence
// never reaches the derived criterion.
const INFER_MD = `---
# the report lane (authored while drafting v2)
clarify: false
---
produce the weekly report
`;

const HOOKS_YAML = `# completion contract
hooks:
  stop:
    # matches the prose convention reports/{ISO-week}-weekly.md
    - artifact: reports/*-weekly.md
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

  it('reads one infer.md — clarify frontmatter + criterion body, guidance comments excluded', () => {
    expect(parseInferMd(INFER_MD)).toEqual({
      value: { clarify: false, body: 'produce the weekly report\n' },
      error: null,
    });
  });

  it('a fenceless infer.md is body-verbatim with no flags', () => {
    expect(parseInferMd('just a criterion\n')).toEqual({
      value: { body: 'just a criterion\n' },
      error: null,
    });
  });

  it('a comments-only fence is valid (guidance channel) and derives no clarify', () => {
    const raw = '---\n# guidance only\n---\nCriterion.\n';
    expect(parseInferMd(raw)).toEqual({ value: { body: 'Criterion.\n' }, error: null });
  });

  it.each([
    ['unterminated fence', '---\nclarify: false\nno close\n', /never closes/],
    ['non-mapping fence', '---\n- a\n---\nx\n', /must be a YAML mapping/],
    ['unknown frontmatter key', '---\nfoo: 1\n---\nx\n', /allows only "clarify"/],
    ['retired default key', '---\ndefault: true\n---\nx\n', /allows only "clarify"/],
    ['non-boolean clarify', '---\nclarify: maybe\n---\nx\n', /clarify must be true or false/],
  ] as const)('parseInferMd reports %s', (_label, raw, pattern) => {
    expect(parseInferMd(raw).error).toMatch(pattern);
  });

  it('a "---" line NOT at offset 0 is body text, never a fence (markdown hr survives)', () => {
    const raw = 'criterion first\n---\nmore prose\n';
    expect(parseInferMd(raw)).toEqual({ value: { body: raw }, error: null });
  });

  it('reads one hooks.yaml declaration', () => {
    expect(deriveHooks(docOf(HOOKS_YAML))).toEqual({ stop: [{ artifact: 'reports/*-weekly.md' }] });
  });

  it('a malformed hooks value is omitted from the draft, never coerced', () => {
    const raw = 'hooks:\n  stop:\n    - nonsense\n';
    expect(deriveHooks(docOf(raw))).toBeUndefined();
  });

  it('an absent hooks.yaml (empty buffer) derives no hooks', () => {
    expect(deriveHooks(docOf(''))).toBeUndefined();
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

  // The regression the splice primitives exist for: a body edit must keep the
  // fence (its comments included) byte-verbatim, and a clarify edit must keep
  // the body and the fence comments.
  it('a body edit keeps the frontmatter fence byte-verbatim', () => {
    const next = applyInferBody(INFER_MD, 'produce or revise the weekly report\n');
    expect(next).toContain('# the report lane (authored while drafting v2)');
    expect(next).toContain('clarify: false');
    expect(parseInferMd(next).value.body).toBe('produce or revise the weekly report\n');
  });

  it('a clarify patch rewrites the flag, keeps fence comments, and undefined deletes the key', () => {
    const flipped = applyInferClarify(INFER_MD, true);
    expect(flipped).toContain('# the report lane (authored while drafting v2)');
    expect(parseInferMd(flipped).value).toEqual({ clarify: true, body: 'produce the weekly report\n' });

    const inherited = applyInferClarify(flipped, undefined);
    expect(inherited).not.toContain('clarify:');
    expect(inherited).toContain('# the report lane');
    expect(parseInferMd(inherited).value.clarify).toBeUndefined();
  });

  it('deleting clarify from a flag-only fence removes the fence entirely', () => {
    const raw = '---\nclarify: false\n---\ncriterion\n';
    expect(applyInferClarify(raw, undefined)).toBe('criterion\n');
  });

  it('setting clarify on a fenceless file mints the fence', () => {
    const next = applyInferClarify('criterion\n', false);
    expect(parseInferMd(next).value).toEqual({ clarify: false, body: 'criterion\n' });
  });

  it('a broken (unterminated) fence makes both splices a no-op — the raw view owns the repair', () => {
    const broken = '---\nclarify: false\nno close\n';
    expect(applyInferBody(broken, 'x\n')).toBe(broken);
    expect(applyInferClarify(broken, true)).toBe(broken);
  });

  it('applyHooks writes the declaration, keeps file comments, and an empty list deletes the key', () => {
    const next = editRaw(HOOKS_YAML, (doc) => applyHooks(doc, [{ action: 'create_file' }]));
    expect(next).toContain('# completion contract');
    expect(deriveHooks(docOf(next))).toEqual({ stop: [{ action: 'create_file' }] });

    const cleared = editRaw(next, (doc) => applyHooks(doc, []));
    expect(cleared).not.toContain('stop:');
    expect(deriveHooks(docOf(cleared))).toBeUndefined();
  });

});

describe('mcp.servers round-trip', () => {
  it('a stdio server survives derive → apply unchanged', () => {
    const servers = {
      'ops-db': {
        transport: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@acme/ops-db-mcp'],
        env: { DB_URL: '${secret:OPS_DB_URL}' },
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

  it('http headers survive derive → apply unchanged', () => {
    const servers = {
      remote: {
        transport: 'http' as const,
        url: 'https://mcp.example/sse',
        headers: { Authorization: '${secret:OPS_API_TOKEN}', 'X-Workspace-Id': 'ws-abc' },
      },
    };
    const next = editRaw(JOB_YAML, (doc) => applyMcpServers(doc, servers));
    expect(deriveMcpServers(docOf(next))).toEqual(servers);
  });

  it("headers are dropped on stdio — env is that transport's only credential door", () => {
    const next = editRaw(JOB_YAML, (doc) =>
      applyMcpServers(doc, {
        local: { transport: 'stdio', command: 'npx', headers: { Authorization: 'OPS_API_TOKEN' } },
      }),
    );
    expect(deriveMcpServers(docOf(next))).toEqual({ local: { transport: 'stdio', command: 'npx' } });
  });

  it.each([
    [
      'a malformed secret reference',
      { api: { transport: 'http' as const, url: 'https://x/mcp', headers: { Authorization: '${secret:not-caps}' } } },
      /malformed/,
    ],
    [
      'an empty value',
      { api: { transport: 'http' as const, url: 'https://x/mcp', headers: { Authorization: ' ' } } },
      /non-empty/,
    ],
    [
      'headers declared on stdio',
      { db: { transport: 'stdio' as const, command: 'npx', headers: { Authorization: '${secret:OPS_API_TOKEN}' } } },
      /applies to http transport only/,
    ],
  ])('the validator refuses %s', (_label, servers, pattern) => {
    expect(validateMcpServers(servers).join('\n')).toMatch(pattern);
  });

  it.each([
    ['a plain-text header', { api: { transport: 'http' as const, url: 'https://x/mcp', headers: { 'X-Workspace-Id': 'ws-abc' } } }],
    ['a secret reference', { api: { transport: 'http' as const, url: 'https://x/mcp', headers: { Authorization: '${secret:OPS_API_TOKEN}' } } }],
    ['a plain-text env value', { db: { transport: 'stdio' as const, command: 'npx', env: { DB_HOST: 'localhost' } } }],
    // `${secret:KEY}` is the only lookup marker, so an ALL-CAPS literal is a literal.
    ['an ALL-CAPS plain-text value', { api: { transport: 'http' as const, url: 'https://x/mcp', headers: { Authorization: 'OPS_API_TOKEN' } } }],
  ])('the validator accepts %s', (_label, servers) => {
    expect(validateMcpServers(servers)).toEqual([]);
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

  it('a bare ALL-CAPS env value stays plain text — the value shape never implies a store lookup', () => {
    expect(
      validateMcpServers({ db: { transport: 'stdio', command: 'npx', env: { DB_URL: 'OPS_DB_URL' } } }),
    ).toEqual([]);
  });
});

describe('apis round-trip (declared REST APIs)', () => {
  it('an entry with headers + allow survives derive → apply unchanged', () => {
    const servers = {
      douzone: {
        baseUrl: 'https://erp.example.com/api',
        headers: { Authorization: '${secret:DOUZONE_TOKEN}' },
        allow: ['GET *', 'POST /vouchers/**'],
      },
    };
    const next = editRaw(JOB_YAML, (doc) => applyApiServers(doc, servers));
    expect(deriveApiServers(docOf(next))).toEqual(servers);
    expect(next).toContain('# the weekly report job');
  });

  it('a self entry round-trips without acquiring the connectivity keys that would invalidate it', () => {
    const servers = { ant: { self: true as const, allow: ['GET /account/agents/**'] } };
    const next = editRaw(JOB_YAML, (doc) => applyApiServers(doc, servers));
    expect(deriveApiServers(docOf(next))).toEqual(servers);
    expect(next).not.toContain('baseUrl');
    expect(validateApiServers(deriveApiServers(docOf(next)))).toEqual([]);
  });

  it('a wrong self literal survives the round trip so the validator can refuse it', () => {
    const servers = { ant: { self: 'true' } } as never;
    const next = editRaw(JOB_YAML, (doc) => applyApiServers(doc, servers));
    expect(validateApiServers(deriveApiServers(docOf(next))).join('\n')).toMatch(/literal boolean true/);
  });

  it('a raw-authored apis block survives an mcp form save untouched (setIn does not rewrite siblings)', () => {
    const withApis = editRaw(JOB_YAML, (doc) =>
      applyApiServers(doc, { erp: { baseUrl: 'https://x/api' } }),
    );
    const afterMcpSave = editRaw(withApis, (doc) =>
      applyMcpServers(doc, { db: { transport: 'stdio', command: 'npx' } }),
    );
    expect(deriveApiServers(docOf(afterMcpSave))).toEqual({ erp: { baseUrl: 'https://x/api' } });
  });

  it('removing the last entry drops the apis block; validator refuses missing baseUrl and mcp-shaped keys', () => {
    const withApis = editRaw(JOB_YAML, (doc) => applyApiServers(doc, { erp: { baseUrl: 'https://x/api' } }));
    const cleared = editRaw(withApis, (doc) => applyApiServers(doc, {}));
    expect(cleared).not.toContain('apis:');

    expect(validateApiServers({ erp: {} as never }).join('\n')).toMatch(/"baseUrl" is required/);
    expect(validateApiServers({ erp: { baseUrl: 'https://x/api', url: 'https://y' } as never }).join('\n')).toMatch(
      /belongs to mcp\.servers/,
    );
    expect(validateApiServers({ erp: { baseUrl: 'https://x/api', allow: ['GET'] } }).join('\n')).toMatch(/allow rule/);
    expect(
      validateApiServers({ erp: { baseUrl: 'https://x/api', headers: { Authorization: '${secret:DOUZONE_TOKEN}' }, allow: ['GET *'] } }),
    ).toEqual([]);
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

describe('per-file intent contract (client mirror of the BE gate)', () => {
  it.each([
    ['valid criterion', 'alerts need triage\n', null],
    ['freshly added intent has no criterion yet', '', /requires a matching criterion/],
    ['whitespace-only body', '---\nclarify: true\n---\n   \n', /requires a matching criterion/],
    ['criterion cap', 'x'.repeat(1001), /exceeds 1000/],
    ['frontmatter error propagates', '---\nfoo: 1\n---\nx\n', /allows only "clarify"/],
  ] as const)('validateInferDoc: %s', (_label, raw, expected) => {
    const errors = validateInferDoc(raw, 'triage');
    if (expected === null) expect(errors).toEqual([]);
    else expect(errors.join('\n')).toMatch(expected);
  });

  // Hook docs ride the shared syntax rules on the RAW hooks value (no builtin
  // predicate: a bare tool name passes here and the BE save gate stays the
  // authority). Judged on the document, so raw-view mistakes surface pre-save.
  it.each([
    ['a valid hook pair', 'hooks:\n  stop:\n    - artifact: reports/*.md\n    - action: create_file\n', null],
    ['empty document = no hooks', '', null],
    ['missing hooks wrapper key', 'stop:\n  - artifact: r.md\n', /exactly one top-level "hooks" key/],
    ['extra top-level key', 'hooks:\n  stop:\n    - artifact: r.md\nextra: 1\n', /exactly one top-level "hooks" key/],
    ['empty hook value', 'hooks:\n  stop:\n    - artifact: " "\n', /non-empty string/],
    ['artifact traversal', 'hooks:\n  stop:\n    - artifact: ../escape.md\n', /path segment/],
    ['malformed mcp action', 'hooks:\n  stop:\n    - action: mcp__Server__tool\n', /mcp__\{server\}__\{tool\}/],
    ['hook cap', `hooks:\n  stop:\n${Array.from({ length: 9 }, (_, i) => `    - artifact: f${i}.md`).join('\n')}\n`, /cap is 8/],
  ] as const)('validateHooksDoc: %s', (_label, raw, expected) => {
    const errors = validateHooksDoc(docOf(raw), 'triage');
    if (expected === null) expect(errors).toEqual([]);
    else expect(errors.join('\n')).toMatch(expected);
  });

});

describe('planSaves — identity-first ordering + optional-file delete-on-empty', () => {
  const doc = (key: string, path: string, raw: string, savedRaw: string) => ({
    key,
    path,
    raw,
    savedRaw,
    dirty: raw !== savedRaw,
  });

  it('clean docs produce no operations', () => {
    expect(planSaves([doc('main', 'jobs/w/job.yaml', 'id: w\n', 'id: w\n')])).toEqual([]);
  });

  it('emptied hooks.yaml/prompt.md become DELETEs; never-existed empty ones are no-ops', () => {
    const ops = planSaves([
      doc('hooks:a', 'jobs/w/intents/a/hooks.yaml', '', 'hooks:\n  stop:\n    - artifact: r.md\n'),
      doc('hooks:b', 'jobs/w/intents/b/hooks.yaml', '', ''),
      doc('prompt:a', 'jobs/w/intents/a/prompt.md', '', 'Old prose.\n'),
      doc('prompt:b', 'jobs/w/intents/b/prompt.md', '', ''),
      doc('prompt:c', 'jobs/w/intents/c/prompt.md', 'New prose.\n', ''),
    ]);
    expect(ops).toEqual([
      { op: 'delete', path: 'jobs/w/intents/a/hooks.yaml' },
      { op: 'delete', path: 'jobs/w/intents/a/prompt.md' },
      { op: 'put', path: 'jobs/w/intents/c/prompt.md', content: 'New prose.\n' },
    ]);
  });

  it('infer.md is REQUIRED — an emptied one still plans as a PUT, never a delete', () => {
    const ops = planSaves([doc('infer:a', 'jobs/w/intents/a/infer.md', '', 'old criterion\n')]);
    expect(ops).toEqual([{ op: 'put', path: 'jobs/w/intents/a/infer.md', content: '' }]);
  });

  it('identity docs save first; the rest keep insertion order', () => {
    const ops = planSaves([
      doc('infer:b', 'jobs/w/intents/b/infer.md', 'y2\n', 'y\n'),
      doc('main', 'jobs/w/job.yaml', 'id: w\nname: W2\n', 'id: w\nname: W\n'),
      doc('infer:a', 'jobs/w/intents/a/infer.md', 'x2\n', 'x\n'),
    ]);
    expect(ops.map((o) => o.path)).toEqual([
      'jobs/w/job.yaml',
      'jobs/w/intents/b/infer.md',
      'jobs/w/intents/a/infer.md',
    ]);
  });
});

describe('classifyDefinitionPath — file-tree navigation targets', () => {
  it.each([
    ['agent.yaml', { kind: 'agent-yaml' }],
    // A level IS its directory — the row that opens that level's screen.
    ['jobs/weekly', { kind: 'job-dir', jobId: 'weekly' }],
    ['jobs/weekly/job.yaml', { kind: 'job-yaml', jobId: 'weekly' }],
    ['jobs/weekly/intents', { kind: 'intents-dir', jobId: 'weekly' }],
    ['jobs/weekly/intents/report', { kind: 'intent-dir', jobId: 'weekly', intentId: 'report' }],
    ['jobs/weekly/intents/report/infer.md', { kind: 'intent-infer', jobId: 'weekly', intentId: 'report' }],
    ['jobs/weekly/intents/report/prompt.md', { kind: 'intent-prompt', jobId: 'weekly', intentId: 'report' }],
    ['jobs/weekly/intents/report/hooks.yaml', { kind: 'intent-hooks', jobId: 'weekly', intentId: 'report' }],
    // Legacy/stray files under an intent dir are 'other', never 'prose' —
    // they must not open in the Prompts editor.
    ['jobs/weekly/intents/report/intent.yaml', { kind: 'other' }],
    ['jobs/weekly/intents/report/notes.md', { kind: 'other' }],
    ['base/role.md', { kind: 'prose' }],
    ['jobs/weekly/base/system.md', { kind: 'prose', jobId: 'weekly' }],
    ['random/notes.txt', { kind: 'other' }],
  ] as const)('%s', (path, expected) => {
    expect(classifyDefinitionPath(path)).toEqual(expected);
  });

  // The other half of the isomorphism: every owned kind must name the card it
  // scrolls to. 'prose' had no entry, so a base/*.md click opened the buffer
  // and left the reader on whatever card they were already looking at.
  // The rename policy in one assertion: a LEVEL's directory and the files
  // inside it are different cards, so a file card can never own its
  // container's id (the intent id used to live in infer.md's card).
  it('a level directory and its files map to different cards', () => {
    const dir = classifyDefinitionPath('jobs/weekly/intents/report').kind;
    const infer = classifyDefinitionPath('jobs/weekly/intents/report/infer.md').kind;
    expect(DEFINITION_DIR_KINDS.has(dir)).toBe(true);
    expect(DEFINITION_DIR_KINDS.has(infer)).toBe(false);
    expect(CARD_OF_KIND[dir as 'intent-dir']).not.toBe(CARD_OF_KIND[infer as 'intent-infer']);
  });

  it('every kind but "other" maps to a card id', () => {
    const kinds = [
      'agent.yaml',
      'jobs/weekly',
      'jobs/weekly/job.yaml',
      'jobs/weekly/intents',
      'jobs/weekly/intents/report',
      'jobs/weekly/intents/report/infer.md',
      'jobs/weekly/intents/report/prompt.md',
      'jobs/weekly/intents/report/hooks.yaml',
      'base/role.md',
    ].map((p) => classifyDefinitionPath(p).kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const kind of kinds) {
      expect(kind).not.toBe('other');
      expect(CARD_OF_KIND[kind as Exclude<typeof kind, 'other'>]).toMatch(/^c3g-/);
    }
  });
});
