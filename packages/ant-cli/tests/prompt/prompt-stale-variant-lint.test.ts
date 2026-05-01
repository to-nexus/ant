/**
 * D39 (v9) — Prompt Body × Registry Consistency
 *
 * Prompt template bodies (`templates/**\/*.md`) MUST NOT cite registry-
 * deprecated variant vocabulary (v7 / v8 sweep):
 *
 *   - concept = `modernCasual` / `sfFantasy` / `darkFantasy` / `threeKingdoms` / `martialArts`
 *               (D32-revised v9 narrowed concept registry to 5 active variants — registry size unchanged from v8)
 *   - genre   = `puzzle` / `casual` / `arcade` / `action` / `platformer` / `shooter` / `rpg` / `strategy`
 *               (D31-revised v9 narrowed genre registry to 6 sub-genres — match3 / slidingPuzzle / cardSolitaire / arcadePaddle / arcadeSnake / crowdRunner)
 *   - coreLoop= `fight` / `build` / `explore`
 *               (D31-revised v9 narrowed coreLoop to 3 universals — solve / collect / survive)
 *   - perspective = `3d`
 *               (D30 v7 single-element registry)
 *   - gameEngine = `godot` / `cocos-creator`
 *               (D29 v7 single-element registry)
 *
 * Two scan modes:
 *
 *   (a) **Slot-keyed pattern** — `concept=...` / `genre=...` / `perspective=...`
 *       / `coreLoop=...` / `gameEngine=...` / `<gameArtTier>...</gameArtTier>` /
 *       `<gameContentTier>...</gameContentTier>` / `<techTier>...|...</techTier>`
 *       — narrow because slot prefix scopes the value to a registry slot.
 *
 *   (b) **Unique-word boundary** — `modernCasual` / `sfFantasy` / `darkFantasy`
 *       / `threeKingdoms` / `martialArts` are PascalCase concept ids with no
 *       overlap with normal English; bare-word matches are also flagged.
 *
 * Allowlist (intentional Phase 5+ hook citations):
 *
 *   A line whose surrounding context (the same line or its immediate
 *   neighbour) carries any of these markers is allowed to mention the
 *   deprecated word: `Phase 5+`, `archive`, `deferred`, `hook`, `legacy`,
 *   `폐기`. Examples:
 *
 *     - `basis/techTier/gameEngine/_preamble.md` says "godot / cocos-creator
 *       (Phase 5+ hook) ... deferred ..." — allowed.
 *     - `gen-art-*` historical references in v9 doc-comments — allowed
 *       when the same paragraph mentions `legacy` / `archive`.
 *
 * Why this guard exists: the LLM-emitted candidate enumeration is registry-
 * driven (decompose serialises `gameArtConceptCandidates` etc. from the
 * SSOT array), but prompt-body example sentences and tables are hand-
 * authored and can drift. A drift means the LLM sees a registry-narrowed
 * candidate set + a prompt-body deprecated example simultaneously — which
 * either causes parser-time rejection + retry (cost) or silent fallback to
 * `defaultOnRetryExhaustion` (mood-table disconnect). This lint catches the
 * drift before it ships.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================
// Deprecated vocabulary (kept in sync with rac.ts unions + registry arrays)
// ============================================

const DEPRECATED_CONCEPT = ['modernCasual', 'sfFantasy', 'darkFantasy', 'threeKingdoms', 'martialArts'] as const;
const DEPRECATED_GENRE = ['puzzle', 'casual', 'arcade', 'action', 'platformer', 'shooter', 'rpg', 'strategy'] as const;
const DEPRECATED_CORE_LOOP = ['fight', 'build', 'explore'] as const;
const DEPRECATED_PERSPECTIVE = ['3d'] as const;
const DEPRECATED_GAME_ENGINE = ['godot', 'cocos-creator'] as const;

// Markers that authorise the citation as an intentional Phase 5+ hook /
// historical reference. Matched case-insensitively on the same line OR the
// immediately preceding/following line.
const ALLOWLIST_MARKERS = [
  'phase 5+',
  'phase5+',
  'archive',
  'deferred',
  'hook',
  'legacy',
  '폐기',
] as const;

// ============================================
// Filesystem walk
// ============================================

const TEMPLATES_ROOT = path.resolve(__dirname, '../../src/core/prompt/templates');

function walkMarkdown(rootAbs: string): string[] {
  const out: string[] = [];
  const stack: string[] = [rootAbs];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const childAbs = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(childAbs);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(childAbs);
      }
    }
  }
  return out;
}

// ============================================
// Scan helpers
// ============================================

interface Citation {
  fileRel: string;
  line: number;       // 1-based
  pattern: string;    // human-readable matched pattern
  text: string;       // matching line content (trimmed)
}

function scanFileForCitations(fileAbs: string, fileRel: string): Citation[] {
  const text = fs.readFileSync(fileAbs, 'utf8');
  const lines = text.split('\n');
  const out: Citation[] = [];

  const lineHasMarker = (idx: number): boolean => {
    const window = [lines[idx - 1] ?? '', lines[idx] ?? '', lines[idx + 1] ?? ''];
    const joined = window.join(' ').toLowerCase();
    return ALLOWLIST_MARKERS.some(m => joined.includes(m));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // (a) Slot-keyed value patterns. Match on `slot=value` literally; this
    // catches both prose ("e.g. `concept=modernCasual`") and tag emit
    // examples ("<gameArtTier>concept=modernCasual,...>").
    const slotPatterns: Array<{ slot: string; values: ReadonlyArray<string> }> = [
      { slot: 'concept', values: DEPRECATED_CONCEPT },
      { slot: 'genre', values: DEPRECATED_GENRE },
      { slot: 'coreLoop', values: DEPRECATED_CORE_LOOP },
      { slot: 'perspective', values: DEPRECATED_PERSPECTIVE },
      { slot: 'gameEngine', values: DEPRECATED_GAME_ENGINE },
    ];

    for (const { slot, values } of slotPatterns) {
      for (const v of values) {
        // Word-boundary on the value side; slot side is literal.
        const re = new RegExp(`${slot}=${escapeRegex(v)}(?![A-Za-z0-9_-])`);
        if (re.test(line) && !lineHasMarker(i)) {
          out.push({
            fileRel,
            line: i + 1,
            pattern: `${slot}=${v}`,
            text: line.trim().slice(0, 200),
          });
        }
      }
    }

    // (b) Unique-word boundary — concept ids are PascalCase with no
    // English overlap. Bare-word match (with markdown-friendly boundary).
    for (const v of DEPRECATED_CONCEPT) {
      const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(v)}(?![A-Za-z0-9_])`);
      if (re.test(line) && !lineHasMarker(i)) {
        out.push({
          fileRel,
          line: i + 1,
          pattern: `bare-word ${v}`,
          text: line.trim().slice(0, 200),
        });
      }
    }
  }

  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================
// Tests
// ============================================

describe('D39 — Prompt Body × Registry Consistency', () => {
  const templates = walkMarkdown(TEMPLATES_ROOT);

  it('templates root resolves to a non-empty directory', () => {
    expect(fs.existsSync(TEMPLATES_ROOT)).toBe(true);
    expect(templates.length).toBeGreaterThan(0);
  });

  it('no prompt template body cites a deprecated registry variant outside the Phase 5+ hook allowlist', () => {
    const allCitations: Citation[] = [];
    for (const fileAbs of templates) {
      const fileRel = path.relative(TEMPLATES_ROOT, fileAbs);
      allCitations.push(...scanFileForCitations(fileAbs, fileRel));
    }

    if (allCitations.length > 0) {
      const summary = allCitations
        .map(c => `  - ${c.fileRel}:${c.line}  [${c.pattern}]\n      ${c.text}`)
        .join('\n');
      throw new Error(
        `D39 lint failure — ${allCitations.length} prompt body citation(s) of deprecated registry variants found.\n` +
        `Add a Phase 5+ hook marker to the same line / adjacent line (one of: ${ALLOWLIST_MARKERS.join(', ')}) ` +
        `OR replace the citation with a v8/v9 registry-current variant.\n` +
        `Citations:\n${summary}`,
      );
    }
    expect(allCitations).toEqual([]);
  });

  it('the allowlist marker mechanism actually allows the gameEngine _preamble Phase 5+ hook citation', () => {
    // Sanity: we KNOW basis/techTier/gameEngine/_preamble.md cites
    // godot / cocos-creator under a Phase 5+ marker. Verify the lint
    // infrastructure recognises the allowlist marker (otherwise a future
    // refactor that drops the marker would not be caught).
    const preamblePath = path.join(TEMPLATES_ROOT, 'basis/techTier/gameEngine/_preamble.md');
    expect(fs.existsSync(preamblePath)).toBe(true);
    const citations = scanFileForCitations(preamblePath, 'basis/techTier/gameEngine/_preamble.md');
    // Either: (i) no citations because the file does not currently mention
    // the deprecated names, or (ii) all citations are allowlisted by
    // markers. The lint test above requires (ii)-or-(i); this sanity test
    // documents the EXPECTATION that the file is allowed to mention them.
    expect(citations).toEqual([]);
  });
});

// ============================================
// D45 (v9.1) — gameContentTier preamble strict scan
// ============================================
//
// Why this guard exists: D39's bare-word boundary scan only fires on
// PascalCase concept ids (modernCasual / sfFantasy / ...) which have no
// English overlap. Plain-English deprecated genre / coreLoop words
// (puzzle / casual / arcade / action / platformer / shooter / rpg /
// strategy / fight / build / explore) are NOT bare-word-scanned because
// they collide with normal prose and would generate false positives in
// every other template.
//
// HOWEVER, four high-risk preamble files are uniquely vulnerable to
// silent drift because they enumerate genre / coreLoop tables:
//
//   - `basis/gameContentTier/_preamble.md` (universal ledger)
//   - `jobs/plan/basis/gameContentTier/_preamble.md`
//   - `jobs/code/basis/gameContentTier/_preamble.md`
//   - `jobs/design/basis/gameContentTier/_preamble.md`
//
// In these four files, a plain-English deprecated word in a table row /
// example is almost certainly a stale registry citation rather than
// incidental prose — so we add a stricter bare-word scan scoped to
// these files only. Allowlist markers (Phase 5+ / archive / deferred /
// hook / legacy / 폐기) on the same / adjacent line still permit
// intentional historical references.

const STRICT_GAME_CONTENT_TIER_PREAMBLE_FILES = [
  'basis/gameContentTier/_preamble.md',
  'jobs/plan/basis/gameContentTier/_preamble.md',
  'jobs/code/basis/gameContentTier/_preamble.md',
  'jobs/design/basis/gameContentTier/_preamble.md',
] as const;

const STRICT_BARE_WORD_DEPRECATED = [
  ...DEPRECATED_GENRE,
  ...DEPRECATED_CORE_LOOP,
] as const;

function scanGameContentTierPreambleStrict(fileAbs: string, fileRel: string): Citation[] {
  const text = fs.readFileSync(fileAbs, 'utf8');
  const lines = text.split('\n');
  const out: Citation[] = [];

  const lineHasMarker = (idx: number): boolean => {
    const window = [lines[idx - 1] ?? '', lines[idx] ?? '', lines[idx + 1] ?? ''];
    const joined = window.join(' ').toLowerCase();
    return ALLOWLIST_MARKERS.some(m => joined.includes(m));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const v of STRICT_BARE_WORD_DEPRECATED) {
      // Word-boundary, case-sensitive. Camel-case compounds like
      // `slidingPuzzle` / `arcadePaddle` are NOT matched (because the
      // capital letter is part of the same word and `(?<![A-Za-z0-9_])`
      // anchors the boundary on word-character class). Hyphenated
      // compounds like `sliding-puzzle` ARE matched (hyphen is not a
      // word character) — that is the v8 mismatch we want to catch.
      const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(v)}(?![A-Za-z0-9_])`);
      if (re.test(line) && !lineHasMarker(i)) {
        out.push({
          fileRel,
          line: i + 1,
          pattern: `strict bare-word ${v}`,
          text: line.trim().slice(0, 200),
        });
      }
    }
  }
  return out;
}

describe('D45 (v9.1) — gameContentTier preamble × Registry Consistency (strict)', () => {
  it('the four gameContentTier preamble files all exist', () => {
    for (const fileRel of STRICT_GAME_CONTENT_TIER_PREAMBLE_FILES) {
      const fileAbs = path.join(TEMPLATES_ROOT, fileRel);
      expect(fs.existsSync(fileAbs)).toBe(true);
    }
  });

  it('these four high-risk preamble bodies do not cite deprecated bare words outside the Phase 5+ hook allowlist', () => {
    const allCitations: Citation[] = [];
    for (const fileRel of STRICT_GAME_CONTENT_TIER_PREAMBLE_FILES) {
      const fileAbs = path.join(TEMPLATES_ROOT, fileRel);
      allCitations.push(...scanGameContentTierPreambleStrict(fileAbs, fileRel));
    }

    if (allCitations.length > 0) {
      const summary = allCitations
        .map(c => `  - ${c.fileRel}:${c.line}  [${c.pattern}]\n      ${c.text}`)
        .join('\n');
      throw new Error(
        `D45 lint failure — ${allCitations.length} bare-word citation(s) of deprecated genre / coreLoop in gameContentTier preamble bodies.\n` +
        `These four files are uniquely vulnerable to silent registry drift because they enumerate genre / coreLoop tables — a plain-English deprecated word in a row / example is almost certainly stale.\n` +
        `Add a Phase 5+ hook marker (one of: ${ALLOWLIST_MARKERS.join(', ')}) to the same / adjacent line OR replace with a v9 registry-current variant (match3 / slidingPuzzle / cardSolitaire / arcadePaddle / arcadeSnake / crowdRunner; solve / collect / survive).\n` +
        `Citations:\n${summary}`,
      );
    }
    expect(allCitations).toEqual([]);
  });

  it('camel-case compound names (slidingPuzzle / cardSolitaire / arcadePaddle / arcadeSnake / crowdRunner) are NOT flagged by the strict scan', () => {
    // Document the regex boundary behaviour: the strict scan must NOT
    // false-positive on the registry-current compounds. Use a synthetic
    // line to verify.
    const tmpLine = 'genres: match3, slidingPuzzle, cardSolitaire, arcadePaddle, arcadeSnake, crowdRunner';
    const fakeFile = path.join(TEMPLATES_ROOT, '__nonexistent__.md');
    // Use a synthetic in-memory scan equivalent.
    const out: Citation[] = [];
    for (const v of STRICT_BARE_WORD_DEPRECATED) {
      const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(v)}(?![A-Za-z0-9_])`);
      if (re.test(tmpLine)) {
        out.push({ fileRel: fakeFile, line: 1, pattern: `strict bare-word ${v}`, text: tmpLine });
      }
    }
    expect(out).toEqual([]);
  });
});

// ============================================
// Prompt-body × revision-metadata cleanliness
// ============================================
//
// Why this guard exists: prompt template bodies are *vertical content* —
// the LLM only needs the rule / decision in force at this point in time.
// Revision-history metadata (`Dxx-revised`, `vN`, `N sub-genres`,
// `vN — Dxx`, `Dxx vN`) is human-only bookkeeping that belongs in
// `.ts` docstrings, registry-source comments, or changelog files —
// putting it in `.md` prompt bodies wastes tokens and confuses the
// model with bookkeeping it cannot act on.
//
// Allowed in `.md`:
//   - decision SSOT IDs cited as a *single* token (`I9`, `D28`) for
//     traceability — these are not version metadata.
//   - real external library version numbers (`validator/v10`,
//     `jsdom v27+`, `Vite v8`, Go module `v0.0.0`) — these are
//     factual statements about external packages.
//
// Forbidden in `.md`:
//   - `D31-revised`, `D32-revised`, `D24-revised`, ... (revision label)
//   - `v8`/`v9` in registry-counting context (e.g. `v9 sub-genres`,
//     `v9 — D31-revised`, `(v8/v9 — Dxx)`)
//   - `N sub-genres` / `N sub-genre set` / `N v9 sub-genres` counts
//
// The patterns below are written narrowly so they only catch the
// metadata shape, not external library versions or single-ID
// citations.

const REVISION_METADATA_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // `D31-revised`, `D32-revised`, `D24-revised`, ... — revision-label form
  { name: 'D<n>-revised', re: /\bD\d+-revised\b/ },
  // `vN — Dxx` / `vN \(Dxx` / `Dxx vN` / `(Dxx vN ...)` — version-coupled-to-decision-id metadata
  { name: 'vN coupled with Dxx', re: /\bv\d+\s*[—\-(]\s*D\d+\b|\bD\d+\s+v\d+\b/ },
  // `N sub-genres` / `N sub-genre set` — registry-count metadata
  { name: 'N sub-genres count', re: /\b\d+\s+sub-genres?(?:\s+(?:set|registry|tuned))?/ },
  // `vN sub-genres` — version-coupled count
  { name: 'vN sub-genres', re: /\bv\d+\s+sub-genres?\b/ },
  // `vN concepts` — version-coupled concept count
  { name: 'vN concepts', re: /\bv\d+\s+concepts?\b/ },
];

function scanFileForRevisionMetadata(fileAbs: string, fileRel: string): Citation[] {
  const text = fs.readFileSync(fileAbs, 'utf8');
  const lines = text.split('\n');
  const out: Citation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, re } of REVISION_METADATA_PATTERNS) {
      if (re.test(line)) {
        out.push({
          fileRel,
          line: i + 1,
          pattern: name,
          text: line.trim().slice(0, 200),
        });
      }
    }
  }
  return out;
}

describe('Prompt body × revision metadata cleanliness', () => {
  const templates = walkMarkdown(TEMPLATES_ROOT);

  it('templates root resolves to a non-empty directory', () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it('no prompt template body contains revision-history metadata (D<n>-revised / vN-coupled-to-Dxx / N sub-genres / vN concepts)', () => {
    const allCitations: Citation[] = [];
    for (const fileAbs of templates) {
      const fileRel = path.relative(TEMPLATES_ROOT, fileAbs);
      allCitations.push(...scanFileForRevisionMetadata(fileAbs, fileRel));
    }

    if (allCitations.length > 0) {
      const summary = allCitations
        .map(c => `  - ${c.fileRel}:${c.line}  [${c.pattern}]\n      ${c.text}`)
        .join('\n');
      throw new Error(
        `Prompt body lint failure — ${allCitations.length} revision-metadata citation(s) found in .md template bodies.\n` +
        `Prompt bodies are vertical content (the rule in force right now). Revision history (D<n>-revised, vN coupled with Dxx, N sub-genres counts, vN concepts) belongs in .ts docstrings / registry comments / changelogs, NOT in .md prompts.\n` +
        `Remove the metadata token while preserving the rule statement.\n` +
        `Citations:\n${summary}`,
      );
    }
    expect(allCitations).toEqual([]);
  });

  it('the metadata regex does NOT false-positive on real external library version numbers', () => {
    // Sanity: the regex must NOT match `validator/v10`, `jsdom v27+`,
    // `Vite v8`, `nestjs/config v3`, Go `v0.0.0` — these are factual
    // statements about external packages, not registry metadata.
    const externalVersions = [
      '`validator/v10`: tag syntax differs from v9',
      'jsdom v27+ is pure ESM',
      'Vite v8 / vitest v4 embed rolldown',
      '`@nestjs/config` v3: schema validation',
      'github.com/{org}/{project}/shared v0.0.0',
      'Exact version (e.g., `v1.10.1`)',
      'shadcn X v0.4 pinned because incompatible with react@19',
    ];
    for (const sample of externalVersions) {
      for (const { name, re } of REVISION_METADATA_PATTERNS) {
        expect(re.test(sample), `pattern "${name}" should NOT match "${sample}"`).toBe(false);
      }
    }
  });

  it('the metadata regex DOES match the patterns we are forbidding', () => {
    // Sanity: confirm the patterns we want forbidden actually trip the
    // regex — otherwise a future refactor that breaks the regex would
    // silently disable the guard.
    const forbidden = [
      '### Concept affinity (D32-revised v9 — guidance, not a hard gate)',
      'D31-revised v9 — 6 sub-genres',
      'D24-revised v8 — sub-sourced canonical',
      'these 5 v9 sub-genres are projectile-centric',
      'all 5 v9 concepts pair naturally',
      'D30 v7 — 3D deferred',
    ];
    for (const sample of forbidden) {
      const matched = REVISION_METADATA_PATTERNS.some(({ re }) => re.test(sample));
      expect(matched, `at least one pattern should match "${sample}"`).toBe(true);
    }
  });
});
