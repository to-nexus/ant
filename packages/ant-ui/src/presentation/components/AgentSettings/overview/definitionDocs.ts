/**
 * Definition-document algebra — the raw ⇄ structured projection the Agent
 * Settings cards run on, kept pure and React-free so the round-trip is
 * testable without a DOM.
 *
 * The raw YAML text is the SSOT: every structured draft (identity / tools /
 * intents) is DERIVED from it, and every structured edit is applied back onto
 * a `parseDocument` of that same text. Editing the YAML by hand therefore
 * updates the forms for free — there is no second state to reconcile, which
 * is what made the old form-vs-raw split clobber each other.
 */

import { isMap, parseDocument, type Document } from 'yaml';
import {
  splitFrontmatter,
  validateIntentHooks,
  type CustomIntentDef,
  type IntentHooks,
  type IntentStopHook,
  type McpServerConfig,
} from '@ant/shared';

export interface MainDraft {
  /** null = `tools.builtin` absent (full universal preset). */
  toolsBuiltin: string[] | null;
  approval: Record<string, 'always' | 'never'>;
}

/** Mirror of the BE `INFER_BODY_MAX` — the criterion renders every turn. */
export const INFER_CRITERION_MAX = 1000;
export const INTENT_CATALOG_CAP = 32;

function toJs(doc: Document, path: string[]): unknown {
  // Materialize through the document (doc.toJS) rather than node.toJSON():
  // resolving a YAML alias (`*anchor`) needs the document context, which a
  // bare node toJSON call lacks — it silently yields nothing.
  const root = doc.toJS() as unknown;
  return path.reduce<unknown>(
    (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    root,
  );
}

/** Parse failures are surfaced, never thrown — the card shows a banner instead. */
export function parseYamlDoc(raw: string): { doc: Document | null; error: string | null } {
  try {
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) return { doc: null, error: doc.errors[0].message };
    return { doc, error: null };
  } catch (e) {
    return { doc: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── derivations (raw → structured) ──────────────────────────────────────────

export function deriveName(doc: Document | null): string {
  const name = doc ? toJs(doc, ['name']) : null;
  return typeof name === 'string' ? name : '';
}

export function deriveId(doc: Document | null): string {
  const id = doc ? toJs(doc, ['id']) : null;
  return typeof id === 'string' ? id : '';
}

/** Agent/job-level `mcp.servers`. Entry order is the document's own order. */
export function deriveMcpServers(doc: Document | null): Record<string, McpServerConfig> {
  const servers = doc ? toJs(doc, ['mcp', 'servers']) : null;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return {};
  const out: Record<string, McpServerConfig> = {};
  for (const [name, raw] of Object.entries(servers as Record<string, unknown>)) {
    const cfg = (raw ?? {}) as Record<string, unknown>;
    out[name] = {
      // Kept verbatim (not coerced) so an unsupported/missing transport stays
      // visible to the validator instead of being silently normalized.
      transport: cfg.transport as McpServerConfig['transport'],
      ...(typeof cfg.command === 'string' ? { command: cfg.command } : {}),
      ...(Array.isArray(cfg.args) ? { args: cfg.args.map((a) => String(a)) } : {}),
      ...(cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env)
        ? {
            env: Object.fromEntries(
              Object.entries(cfg.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
            ),
          }
        : {}),
      ...(typeof cfg.url === 'string' ? { url: cfg.url } : {}),
      ...(cfg.headers && typeof cfg.headers === 'object' && !Array.isArray(cfg.headers)
        ? {
            headers: Object.fromEntries(
              Object.entries(cfg.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
            ),
          }
        : {}),
    };
  }
  return out;
}

export function deriveMainDraft(doc: Document | null): MainDraft {
  const builtin = doc ? toJs(doc, ['tools', 'builtin']) : null;
  const approval = doc ? toJs(doc, ['tools', 'approval']) : null;
  return {
    toolsBuiltin: Array.isArray(builtin) ? builtin.filter((x): x is string => typeof x === 'string') : null,
    approval:
      approval && typeof approval === 'object'
        ? Object.fromEntries(
            Object.entries(approval as Record<string, unknown>).filter(
              (e): e is [string, 'always' | 'never'] => e[1] === 'always' || e[1] === 'never',
            ),
          )
        : {},
  };
}

/**
 * Lenient shape-check for a derived `hooks` value — anything that is not a
 * well-formed `{ stop: [{artifact|action: string}] }` is omitted from the
 * draft (the raw view + BE save gate own the error report, not the form).
 */
function sanitizeHooks(raw: unknown): IntentHooks | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const stop = (raw as Record<string, unknown>).stop;
  if (!Array.isArray(stop) || stop.length === 0) return undefined;
  const entries = stop.filter((e): e is { artifact: string } | { action: string } => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
    const keys = Object.keys(e as Record<string, unknown>);
    return keys.length === 1 && (keys[0] === 'artifact' || keys[0] === 'action')
      && typeof (e as Record<string, unknown>)[keys[0]] === 'string';
  });
  return entries.length === stop.length ? { stop: entries } : undefined;
}

// ── infer.md algebra (frontmatter + criterion body) ─────────────────────────
//
// The fence convention is the shared `splitFrontmatter` — BE loader and this
// editor MUST parse the same bytes the same way, so neither side owns its own
// regex. Edits are comment-preserving: the fence text is patched through a
// yaml Document (comments survive), and the body is spliced verbatim.

export interface InferDraft {
  clarify?: boolean;
  /** The prose criterion (frontmatter excluded, untrimmed). */
  body: string;
}

/** Parse failures are surfaced, never thrown — the card shows a banner instead. */
export function parseInferMd(raw: string): { value: InferDraft; error: string | null } {
  const { frontmatter, body, unterminated } = splitFrontmatter(raw);
  if (unterminated) {
    return { value: { body: '' }, error: 'infer.md opens a "---" frontmatter fence that never closes' };
  }
  if (frontmatter === null) return { value: { body: raw }, error: null };
  const { doc, error } = parseYamlDoc(frontmatter);
  if (error) return { value: { body }, error: `frontmatter: ${error}` };
  const root = doc ? (doc.toJS() as Record<string, unknown> | null) : null;
  if (root == null) return { value: { body }, error: null }; // comments-only fence
  if (typeof root !== 'object' || Array.isArray(root)) {
    return { value: { body }, error: 'infer.md frontmatter must be a YAML mapping (or comments only)' };
  }
  const extras = Object.keys(root).filter((k) => k !== 'clarify');
  if (extras.length > 0) {
    return { value: { body }, error: `infer.md frontmatter allows only "clarify" (got: ${extras.join(', ')})` };
  }
  const clarify = root.clarify;
  if (clarify !== undefined && typeof clarify !== 'boolean') {
    return { value: { body }, error: `clarify must be true or false (got: ${JSON.stringify(clarify)})` };
  }
  return { value: { ...(clarify !== undefined ? { clarify } : {}), body }, error: null };
}

/** Replace the criterion body, keeping the frontmatter fence byte-verbatim. */
export function applyInferBody(raw: string, body: string): string {
  const { body: oldBody, unterminated } = splitFrontmatter(raw);
  if (unterminated) return raw; // broken fence — the raw view owns the repair
  const prefix = raw.slice(0, raw.length - oldBody.length);
  return prefix + body;
}

/**
 * Set/clear the frontmatter `clarify` key, preserving fence comments.
 * `undefined` = "inherit" (key deleted); a fence left with nothing (no keys,
 * no comments) is removed entirely; setting onto a fenceless file mints one.
 *
 * The edit is LINE-LEVEL text splicing, not a yaml Document rewrite: the
 * fence grammar allows exactly one key, and the Document route deletes a
 * key's leading comments with it (the yaml lib attaches them to the pair) —
 * which would erase the authoring-guidance comments the fence exists to hold.
 */
export function applyInferClarify(raw: string, clarify: boolean | undefined): string {
  const { frontmatter, body, unterminated } = splitFrontmatter(raw);
  if (unterminated) return raw;
  if (frontmatter === null) {
    if (clarify === undefined) return raw;
    return `---\nclarify: ${clarify}\n---\n${body}`;
  }
  const kept = frontmatter.split('\n').filter((l) => !/^clarify\s*:/.test(l));
  if (clarify !== undefined) kept.push(`clarify: ${clarify}`);
  const fm = kept.join('\n').replace(/\n+$/, '');
  if (fm.trim() === '') return body;
  return `---\n${fm}\n---\n${body}`;
}

/** One `intents/{id}/hooks.yaml` document → its declaration ({} / absent → undefined). */
export function deriveHooks(doc: Document | null): IntentHooks | undefined {
  return doc ? sanitizeHooks(toJs(doc, ['hooks'])) : undefined;
}

// ── applications (structured → raw), comment-preserving ─────────────────────

export function applyName(doc: Document, name: string): void {
  doc.set('name', name);
}

/**
 * `yaml` throws ("Expected YAML collection at …") when a nested get/set/delete
 * crosses a key that is absent or holds a scalar — which is exactly the
 * scaffolded `id/name/version` file (no `tools:`) and a key left empty under a
 * comment. Normalize the key first: a stale scalar is dropped so the nested
 * write can recreate it, and the return value says whether a nested DELETE has
 * anything to delete at all.
 */
function normalizeMapKey(doc: Document, key: string): boolean {
  const node = doc.get(key, true);
  if (node == null) return false;
  if (isMap(node)) return true;
  doc.delete(key);
  return false;
}

export function applyMainDraft(doc: Document, draft: MainDraft): void {
  const hasToolsMap = normalizeMapKey(doc, 'tools');
  if (draft.toolsBuiltin === null) {
    if (hasToolsMap) doc.deleteIn(['tools', 'builtin']);
  } else {
    doc.setIn(['tools', 'builtin'], draft.toolsBuiltin);
  }
  if (Object.keys(draft.approval).length === 0) {
    if (hasToolsMap) doc.deleteIn(['tools', 'approval']);
  } else {
    doc.setIn(['tools', 'approval'], draft.approval);
  }
  const tools = toJs(doc, ['tools']);
  if (tools && typeof tools === 'object' && Object.keys(tools as object).length === 0) doc.delete('tools');
}

/**
 * Writes `mcp.servers`, dropping keys the chosen transport ignores at runtime
 * (`McpConnectionManager` reads command/args/env for stdio and url for http)
 * so the file never teaches a no-op field. An empty map removes `mcp` entirely.
 */
export function applyMcpServers(doc: Document, servers: Record<string, McpServerConfig>): void {
  const names = Object.keys(servers);
  const hasMcpMap = normalizeMapKey(doc, 'mcp');
  if (names.length === 0) {
    if (hasMcpMap) doc.deleteIn(['mcp', 'servers']);
    const mcp = toJs(doc, ['mcp']);
    if (!mcp || typeof mcp !== 'object' || Object.keys(mcp as object).length === 0) doc.delete('mcp');
    return;
  }
  doc.setIn(
    ['mcp', 'servers'],
    Object.fromEntries(
      names.map((name) => {
        const cfg = servers[name];
        return [
          name,
          cfg.transport === 'http'
            ? {
                transport: 'http',
                url: cfg.url ?? '',
                ...(cfg.headers && Object.keys(cfg.headers).length > 0 ? { headers: cfg.headers } : {}),
              }
            : {
                transport: cfg.transport,
                command: cfg.command ?? '',
                ...(cfg.args && cfg.args.length > 0 ? { args: cfg.args } : {}),
                ...(cfg.env && Object.keys(cfg.env).length > 0 ? { env: cfg.env } : {}),
              },
        ];
      }),
    ),
  );
}

/**
 * Intent edits are SURGICAL per file: `description`/`clarify` splice the
 * infer.md text (`applyInferBody` / `applyInferClarify` — fence comments
 * survive), `hooks` routes to the sibling hooks.yaml document. There is no
 * yaml entry document anymore — infer.md is prose + a one-key fence.
 */
export type IntentPatch = Partial<Pick<CustomIntentDef, 'description' | 'hooks' | 'clarify'>>;

/** Write one hooks.yaml's `hooks.stop` list; an empty list deletes the `hooks` key. */
export function applyHooks(doc: Document, stop: IntentStopHook[]): void {
  if (stop.length > 0) doc.set('hooks', doc.createNode({ stop }));
  else doc.delete('hooks');
}

/**
 * Re-serialize `raw` with `mutate` applied; parse, mutation and serialization
 * failures all leave the text untouched (e.g. deleting an entry whose anchor
 * a later alias still references makes `toString` throw — the edit no-ops
 * instead of crashing the screen; the raw view can perform it).
 */
export function editRaw(raw: string, mutate: (doc: Document) => void): string {
  const { doc } = parseYamlDoc(raw);
  if (!doc) return raw;
  try {
    mutate(doc);
    return doc.toString();
  } catch {
    return raw;
  }
}

// ── validation (client mirror of the BE per-file intents contract) ──────────

/**
 * Contract errors of one infer.md text — the client mirror of the BE
 * `validateInferFile` (id≡dirname died with the id field; the criterion body
 * is the one thing authorship gates on). An empty body on an EXISTING intent
 * is also an error: infer.md is the required file and is never delete-on-empty.
 */
export function validateInferDoc(raw: string, dirname: string): string[] {
  const { value, error } = parseInferMd(raw);
  if (error) return [`intent "${dirname}" ${error}`];
  const body = value.body.trim();
  if (body.length === 0) return [`intent "${dirname}" requires a matching criterion (the infer.md body)`];
  if (body.length > INFER_CRITERION_MAX)
    return [`intent "${dirname}" criterion exceeds ${INFER_CRITERION_MAX} chars — move procedure into prompt.md`];
  return [];
}

/**
 * Contract errors of one hooks.yaml document, judged on the RAW `hooks` value
 * (not the sanitized draft) so a hand-typed mistake in the YAML view surfaces
 * before the BE gate refuses it. An empty document is "no hooks" — valid. No
 * builtin predicate here: that judgement stays with the BE save gate.
 */
export function validateHooksDoc(doc: Document | null, dirname: string): string[] {
  const root = doc ? (doc.toJS() as Record<string, unknown> | null) : null;
  if (root == null) return [];
  if (typeof root !== 'object' || Array.isArray(root)) {
    return [`intent "${dirname}" hooks.yaml must be a mapping with a single "hooks" key`];
  }
  const keys = Object.keys(root);
  if (keys.some((k) => k !== 'hooks') || !('hooks' in root)) {
    return [`intent "${dirname}" hooks.yaml must declare exactly one top-level "hooks" key`];
  }
  return validateIntentHooks(root.hooks).errors.map((msg) => `intent "${dirname}" ${msg}`);
}

// ── save planning (multi-file, ordered) ──────────────────────────────────────

export interface PlannedSave {
  op: 'put' | 'delete';
  path: string;
  content?: string;
}

interface SaveDocLike {
  key: string;
  path: string;
  raw: string;
  savedRaw: string;
  dirty: boolean;
}

/**
 * Order dirty documents into save operations. Rules:
 *   1. Identity docs (agent.yaml / job.yaml) save first; everything else in
 *      insertion order (no cross-file invariants remain since `default` died).
 *   2. An emptied OPTIONAL file (hooks.yaml, prompt.md) is DELETED, not PUT
 *      as '' — an absent file is the canonical "none" (a doc that never
 *      existed AND is empty is skipped entirely). infer.md is REQUIRED and is
 *      never planned as a delete — an emptied one is a validation error
 *      upstream (`validateInferDoc`).
 */
export function planSaves(docs: readonly SaveDocLike[]): PlannedSave[] {
  const dirty = docs.filter((d) => d.dirty);
  const rank = (d: SaveDocLike): number => (d.key === 'agent' || d.key === 'main' ? 0 : 1);
  return dirty
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i)
    .flatMap(({ d }): PlannedSave[] => {
      const optional = d.key.startsWith('hooks:') || d.key.startsWith('prompt:');
      if (optional && d.raw.trim() === '') {
        // Emptied by the editor → delete; never-existed and still empty → no-op.
        return d.savedRaw.trim() === '' ? [] : [{ op: 'delete', path: d.path }];
      }
      return [{ op: 'put', path: d.path, content: d.raw }];
    });
}

// ── definition path classification (file tree navigation) ───────────────────

export type DefinitionPathKind =
  | { kind: 'agent-yaml' }
  | { kind: 'job-dir'; jobId: string }
  | { kind: 'job-yaml'; jobId: string }
  | { kind: 'intent-dir'; jobId: string; intentId: string }
  | { kind: 'intent-infer'; jobId: string; intentId: string }
  | { kind: 'intent-prompt'; jobId: string; intentId: string }
  | { kind: 'intent-hooks'; jobId: string; intentId: string }
  | { kind: 'intents-dir'; jobId: string }
  | { kind: 'prose'; jobId?: string }
  | { kind: 'other' };

/**
 * The kinds that are DIRECTORIES. A level's identity IS its directory name, so
 * these are what the identity cards own — and the reason a tree click on
 * `jobs/{j}/` or `intents/{i}/` opens that level rather than merely expanding.
 */
export const DEFINITION_DIR_KINDS: ReadonlySet<string> = new Set([
  'job-dir',
  'intents-dir',
  'intent-dir',
]);

/** Classify a definition-tree path into the screen/section that owns it. */
export function classifyDefinitionPath(path: string): DefinitionPathKind {
  const parts = path.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  if (parts.length === 1 && parts[0] === 'agent.yaml') return { kind: 'agent-yaml' };
  if (parts[0] === 'jobs' && parts.length === 2) return { kind: 'job-dir', jobId: parts[1] };
  if (parts[0] === 'jobs' && parts.length >= 3) {
    const jobId = parts[1];
    if (parts.length === 3 && parts[2] === 'job.yaml') return { kind: 'job-yaml', jobId };
    if (parts.length === 3 && parts[2] === 'intents') return { kind: 'intents-dir', jobId };
    if (parts[2] === 'intents') {
      // The intent DIRECTORY is the intent's identity (no file declares its
      // id), so it opens the intent screen. Files under it map to their own
      // cards; anything else there (a stray or legacy file) is 'other' —
      // never 'prose'.
      if (parts.length === 4) return { kind: 'intent-dir', jobId, intentId: parts[3] };
      if (parts.length === 5) {
        const intentId = parts[3];
        if (parts[4] === 'infer.md') return { kind: 'intent-infer', jobId, intentId };
        if (parts[4] === 'prompt.md') return { kind: 'intent-prompt', jobId, intentId };
        if (parts[4] === 'hooks.yaml') return { kind: 'intent-hooks', jobId, intentId };
      }
      return { kind: 'other' };
    }
    if (parts[parts.length - 1].endsWith('.md')) return { kind: 'prose', jobId };
    return { kind: 'other' };
  }
  if (parts[parts.length - 1].endsWith('.md')) return { kind: 'prose' };
  return { kind: 'other' };
}

/**
 * kind → the DOM id of the card that owns it, the other half of the file ↔
 * section isomorphism (`classifyDefinitionPath` names the owner, this names
 * where it renders). Every kind but 'other' MUST have an entry — a missing one
 * makes a tree click open a file and then leave the reader wherever they were
 * (which is what happened to 'prose').
 */
export const CARD_OF_KIND: Record<Exclude<DefinitionPathKind['kind'], 'other'>, string> = {
  'agent-yaml': 'c3g-agent',
  'job-dir': 'c3g-tools',
  'job-yaml': 'c3g-tools',
  'intents-dir': 'c3g-intents',
  'intent-dir': 'c3g-intent',
  'intent-infer': 'c3g-intent-criteria',
  'intent-prompt': 'c3g-intent-prompt',
  'intent-hooks': 'c3g-intent-hooks',
  prose: 'c3g-prompts',
};
