#!/usr/bin/env node
/**
 * check-no-legacy-chat.mjs — chat-SSOT §14 negative-grep guard.
 *
 * Phase 14 enforcement of the chat-SSOT unification (master plan
 * `.cursor/plans/chat-ssot-unification_be4c8599.plan.md`). Fails the
 * build whenever the legacy chat substrate (the pre-§5 `ChatMessage` /
 * `MessageContent` / `MessageContentType` / `ChatSession` envelope plus
 * its supporting endpoints / Redis keys / store actions) reappears in
 * production code.
 *
 * The guard runs on `packages/` only (excluding `node_modules`, `dist`,
 * `build`, `.next`, `coverage`, `.turbo`, `.cache`, `__snapshots__`).
 * Inside packages it scans `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.mjs`,
 * `*.cjs` files. Comment-only lines (full-line JSDoc / `//` / shell
 * comments) are skipped so historical docstrings that document the
 * legacy contract for context can stay.
 *
 * Test fixtures (anything under `tests/`, `__tests__/`, or files
 * matching `*.test.*` / `*.stories.*`) are also skipped — they
 * legitimately exercise contract types that the production runtime
 * may not.
 *
 * Usage:
 *   node scripts/check-no-legacy-chat.mjs
 *
 * Exit codes:
 *   0 — every pattern is absent from production code
 *   1 — at least one pattern matched
 *   2 — configuration / IO error
 *
 * Implementation notes:
 *   - Uses Node's native fs + RegExp (no ripgrep dependency) so the
 *     guard runs identically in CI / devcontainers / local shells.
 *   - Mirrors `scripts/git-sweep.mjs` shape for consistency. Each
 *     pattern is a self-contained record so the failure output points
 *     to the exact §C.x of the master plan that the violation breaks.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

/**
 * @typedef {Object} Pattern
 * @property {string} id
 * @property {string} desc          — what the pattern detects
 * @property {string} regex         — ECMAScript regex source (line scan)
 * @property {string[]} [paths]     — package roots to scan (default: ['packages'])
 * @property {string[]} [whitelist] — file/folder prefixes that may carry the pattern
 *                                     (e.g. the FE thin shim during the cutover)
 */

/** @type {Pattern[]} */
const PATTERNS = [
  // ── Legacy chat envelope types — Phase 9 / 11 retired these. ──────
  {
    id: 'C1',
    desc: 'legacy ChatMessage / ChatSession / MessageContent envelope (chat-SSOT §5)',
    regex: String.raw`\b(ChatMessage|ChatSession|MessageContent|MessageContentType|MessageRole)\b`,
    paths: ['packages'],
  },

  // ── Removed FE store/SSE actions (Phase 10). ───────────────────────
  {
    id: 'C2',
    desc: 'removed FE chat slice actions (Phase 10 chat-SSOT)',
    regex: String.raw`\b(addChatMessage|updateChatMessage|removeCancelledMessage|clearChatMessages)\b`,
    paths: ['packages'],
  },
  {
    id: 'C3',
    desc: 'legacy state field state.chatMessages (replaced by chatEvents/streamingBuffers)',
    regex: String.raw`\bchatMessages\b\s*[:.]`,
    paths: ['packages'],
  },

  // ── Retired BE ChatService method surface (Phase 9 §C.4 #1). ──────
  {
    id: 'C4',
    desc: 'retired ChatService methods (Phase 9 §C.4 #1)',
    regex: String.raw`\b(addUserMessage|addChatMessage|startAssistantMessage(?:Async)?|addContentToCurrentMessage|ensureActiveMessageAsync|reconstructMessageFromId|finalizeCurrentMessage(?:Async)?|addJobError|addCancelledMessageAsync|resolveCancelledMessages|getMessagesAsync|updateLastContentMetadata|hasActiveMessage(?:Async)?)\b`,
    paths: ['packages'],
    whitelist: [
      // Worker-side deprecated compat shims for `hasActiveMessage` /
      // `startMessage` — these always return false / null. The pre-§5
      // call sites are gated to skip on the no-op return so removing
      // the shim is a separate (low-priority) cleanup; the negative-
      // grep guard covers active emission, not deprecated stubs.
      'packages/ant-cli/src/core/adapters/ChatAPIClient.ts',
      'packages/ant-cli/src/core/llm-response/LLMResponseService.ts',
    ],
  },

  // ── Retired auxiliary BE modules (Phase 9 §C.4 #2). ───────────────
  {
    id: 'C5',
    desc: 'retired ChatService auxiliary modules (Phase 9 §C.4 #2)',
    regex: String.raw`\b(MessageManager|SessionManager|ContentMerger|ChatLogToMessages)\b`,
    paths: ['packages'],
    whitelist: [
      // The greenfield JobExecutionManager / JobCleanupManager / SessionPersistence
      // names share the prefix `Manager`. They are NOT the retired classes;
      // we match the bare token here so distinct words like "JobCleanupManager"
      // remain unaffected. No active production reference to the bare
      // `MessageManager` / `SessionManager` exists today.
    ],
  },

  // ── Retired MessageBroadcaster legacy shim (Phase 9 §C.4 #3). ─────
  {
    id: 'C6',
    desc: 'retired MessageBroadcaster legacy shim methods (Phase 9 §C.4 #3)',
    regex: String.raw`\b(broadcastMessageFinalized|broadcastContentAdd|broadcastContentUpdate|broadcastContentRemove|broadcastThinkingCollapse)\b`,
    paths: ['packages'],
  },
  {
    id: 'C7',
    desc: 'legacy SSE event names (chat-SSOT replaced these with chat_event_appended / streaming_delta / events_cleared)',
    // `message_start` / `message_complete` are also Anthropic streaming
    // event names — those land in LLM client adapters (third-party SDK
    // contract). To distinguish, we only flag the chat-SSE bag of
    // names, not those two.
    regex: String.raw`['"](?:cancelled_message|message_snapshot|content_append|content_add|content_update|content_remove|user_message|error_message|thinking_collapse)['"]`,
    paths: ['packages'],
  },

  // ── Retired StateStorePort + RedisStateStore chat session API (Phase 9 §C.4 #4). ─
  {
    id: 'C8',
    desc: 'retired chat-session StateStorePort methods (Phase 9 §C.4 #4)',
    regex: String.raw`\b(getChatSession|setChatSession|deleteChatSession|getCurrentMessage|setCurrentMessage|hasActiveMessage)\b`,
    paths: ['packages'],
    whitelist: [
      // Same compat-shim exemption as C4 — these are deprecated stubs.
      'packages/ant-cli/src/core/adapters/ChatAPIClient.ts',
      'packages/ant-cli/src/core/llm-response/LLMResponseService.ts',
    ],
  },

  // ── Retired Redis keys (Phase 9 §C.4 #5). ─────────────────────────
  {
    id: 'C9',
    desc: 'retired Redis chat session keys (Phase 9 §C.4 #5)',
    regex: String.raw`(CHAT\.SESSION|CHAT\.CURRENT_MESSAGE)\b`,
    paths: ['packages'],
  },

  // ── Retired HTTP routes (Phase 9 §C.3). ───────────────────────────
  {
    id: 'C10',
    desc: 'retired choice routes — unified into POST /chat/choice-resolved (Phase 9 §C.3)',
    regex: String.raw`/chat/(triage-choice|eval-save|dismiss-choice)\b`,
    paths: ['packages'],
  },

  // ── chat-SSOT §6 — recordUserTurn carries an internal helper of
  //    the same name; the master plan retired it as a *public* API on
  //    the worker chat client (`setTurnId` is the new public surface).
  //    The helper inside recordUserTurn.ts is allowed to keep the
  //    historical name — it just calls `service.setTurnId(turnId)`.
  {
    id: 'C11',
    desc: 'propagateTurnIdToLLMResponseService — must not appear as a public method on chat clients',
    regex: String.raw`\bpropagateTurnIdToLLMResponseService\b`,
    paths: ['packages'],
    whitelist: [
      // Internal helper name — wraps `service.setTurnId(turnId)` only.
      'packages/ant-cli/src/composition/recordUserTurn.ts',
    ],
  },

  // ── Mint pattern that produced the legacy ChatMessage id. ─────────
  {
    id: 'C12',
    desc: 'msg-${...} id minting — Phase 5 retired the ChatMessage scratchpad',
    // Match `\`msg-${` occurring in a code position. Comment lines are
    // skipped by the line-level filter below.
    regex: String.raw`\bmsg-\$\{`,
    paths: ['packages'],
  },

  // ── session.messages scratchpad references. ──────────────────────
  {
    id: 'C13',
    desc: 'session.messages scratchpad (chat-SSOT §5 replaced by TURN_BUFFER + chat.jsonl)',
    // `currentMessage` is intentionally NOT included here — the LLM
    // token-budget code (`tokenBudget.ts`) tracks "currentMessage"
    // tokens for the in-flight LLM call which is unrelated to chat
    // session state. We only flag the literal `session.messages`
    // pattern that uniquely identified the retired scratchpad.
    regex: String.raw`\bsession\.messages\b`,
    paths: ['packages'],
  },
];

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.next',
  'coverage', '.turbo', '.cache', '__snapshots__',
  // Test fixtures may legitimately exercise contract types that
  // production code must not. They are excluded uniformly.
  'tests', '__tests__',
]);

const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
]);

const SELF_REFERENCES = [
  'scripts/check-no-legacy-chat.mjs',
];

function isSkippedFile(rel) {
  // Test files
  if (/\.test\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) return true;
  if (/\.stories\.(ts|tsx|js|jsx)$/.test(rel)) return true;
  // The discard-legacy script intentionally references the old shape so
  // boot-time migration can collapse pre-§5 chat.jsonl into the new
  // contract. Excluded here because the constants exist solely to read
  // and erase the historical artifact — there is no live emission.
  if (rel === 'packages/ant-cli/scripts/discard-legacy-chat-jsonl.ts') return true;
  return false;
}

/** Comment-only line predicate (cross-language pragmatic match). */
function isCommentOnlyLine(line) {
  const trimmed = line.trim();
  if (trimmed === '') return true;
  if (trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('/*')) return true;
  if (trimmed.startsWith('*')) return true; // JSDoc continuation
  if (trimmed.startsWith('#')) return true; // shell / yaml-like
  return false;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (!SCAN_EXTENSIONS.has(ext)) continue;
    yield full;
  }
}

function rel(absPath) {
  return relative(repoRoot, absPath).split(sep).join('/');
}

function isWhitelisted(fileRel, whitelist) {
  for (const w of whitelist) {
    const wn = w.replace(/\\/g, '/').replace(/\/+$/, '');
    if (fileRel === wn) return true;
    if (fileRel.startsWith(wn + '/')) return true;
  }
  return false;
}

function runPattern(pattern) {
  const paths = pattern.paths ?? ['packages'];
  const existing = paths.filter((p) => existsSync(join(repoRoot, p)));
  if (existing.length === 0) return { hits: [] };

  const re = new RegExp(pattern.regex);
  const whitelist = pattern.whitelist ?? [];

  const hits = [];

  for (const root of existing) {
    for (const abs of walk(join(repoRoot, root))) {
      const r = rel(abs);
      if (SELF_REFERENCES.includes(r)) continue;
      if (isSkippedFile(r)) continue;
      if (isWhitelisted(r, whitelist)) continue;

      let content;
      try {
        const st = statSync(abs);
        if (st.size > 2 * 1024 * 1024) continue;
        content = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      if (!re.test(content)) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isCommentOnlyLine(line)) continue;
        if (re.test(line)) {
          hits.push({ file: r, line: i + 1, text: line.trim().slice(0, 200) });
        }
      }
    }
  }

  return { hits };
}

function main() {
  let totalHits = 0;
  const failures = [];

  for (const p of PATTERNS) {
    const { hits } = runPattern(p);
    if (hits.length === 0) continue;
    totalHits += hits.length;
    failures.push({ pattern: p, hits });
  }

  if (failures.length === 0) {
    console.log('[check-no-legacy-chat] OK — chat-SSOT contract clean (0 violations).');
    process.exit(0);
  }

  console.error('[check-no-legacy-chat] chat-SSOT §14 negative-grep guard FAILED.\n');
  console.error(`Total violations: ${totalHits}\n`);

  for (const { pattern, hits } of failures) {
    console.error(`▸ [${pattern.id}] ${pattern.desc}`);
    console.error(`  regex: /${pattern.regex}/`);
    for (const h of hits.slice(0, 20)) {
      console.error(`  ${h.file}:${h.line}  ${h.text}`);
    }
    if (hits.length > 20) {
      console.error(`  … and ${hits.length - 20} more`);
    }
    console.error('');
  }

  console.error(
    'See `.cursor/plans/chat-ssot-unification_be4c8599.plan.md` and ' +
    'docs/architecture/31-chat-system.md for the SSOT contract.',
  );
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error('[check-no-legacy-chat] aborted:', err?.stack ?? err);
  process.exit(2);
}
