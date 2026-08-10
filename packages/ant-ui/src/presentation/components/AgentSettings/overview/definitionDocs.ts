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
import type { CustomIntentDef, McpServerConfig } from '@ant/shared';

export interface MainDraft {
  /** null = `tools.builtin` absent (full universal preset). */
  toolsBuiltin: string[] | null;
  approval: Record<string, 'always' | 'never'>;
}

export const INTENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const INTENT_DESCRIPTION_MAX = 200;
export const INTENT_CATALOG_CAP = 32;

function toJs(doc: Document, path: string[]): unknown {
  const node = doc.getIn(path);
  return node && typeof (node as { toJSON?: () => unknown }).toJSON === 'function'
    ? (node as { toJSON: () => unknown }).toJSON()
    : node;
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

export function deriveIntents(doc: Document | null): CustomIntentDef[] {
  const listed = doc ? toJs(doc, ['intents']) : null;
  if (!Array.isArray(listed)) return [];
  return listed
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      id: typeof e.id === 'string' ? e.id : '',
      description: typeof e.description === 'string' ? e.description : '',
      ...(Array.isArray(e.injections)
        ? { injections: e.injections.filter((f): f is string => typeof f === 'string') }
        : {}),
    }));
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

export function applyIntentsDraft(doc: Document, entries: CustomIntentDef[]): void {
  doc.set('version', doc.get('version') ?? 1);
  doc.set(
    'intents',
    entries.map((e) => ({
      id: e.id,
      description: e.description,
      ...(e.injections && e.injections.length > 0 ? { injections: e.injections } : {}),
    })),
  );
}

/** Re-serialize `raw` with `mutate` applied; parse failures leave the text untouched. */
export function editRaw(raw: string, mutate: (doc: Document) => void): string {
  const { doc } = parseYamlDoc(raw);
  if (!doc) return raw;
  mutate(doc);
  return doc.toString();
}

// ── validation (client mirror of the BE intents contract) ───────────────────

export function validateIntentsDraft(entries: CustomIntentDef[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!INTENT_ID_PATTERN.test(e.id)) errors.push(`intent id "${e.id}" must match [a-z0-9][a-z0-9-]*`);
    if (e.id === 'general') errors.push('"general" is the implicit fallback intent and cannot be declared');
    if (seen.has(e.id)) errors.push(`duplicate intent id "${e.id}"`);
    seen.add(e.id);
    if (!e.description || e.description.trim().length === 0) errors.push(`intent "${e.id}" requires a description`);
    if (e.description && e.description.length > INTENT_DESCRIPTION_MAX)
      errors.push(`intent "${e.id}" description exceeds ${INTENT_DESCRIPTION_MAX} chars`);
  }
  if (entries.length > INTENT_CATALOG_CAP) errors.push(`intent catalog exceeds the cap of ${INTENT_CATALOG_CAP}`);
  return errors;
}
