/**
 * extractPlanDiff — derive `{ updatedSections }` from a `rev-plan` outcome.
 *
 * The hook in `F3.4` (rev-plan completion) needs to know *which* PRD/GDD
 * sections / stable identifiers a refine pass touched so
 * `detectAffectedTasks` can pivot to the design tasks that cite them.
 *
 * Three sources are consulted in priority order, all dedup-merged into
 * a single sorted list:
 *
 *   1. LLM SSOT tag (`<updated-sections>...</updated-sections>`):
 *      planner overlay asks the LLM to emit a comma-separated list of
 *      the §X / SC- / etc. it just rewrote. Highest signal — when
 *      present, no fallback is needed.
 *   2. Git diff fallback: the `rev-plan` job touches the on-disk
 *      `prd.md` / `gdd.md`. We grep `git diff` for added/removed lines
 *      and locate the closest preceding `## §X` heading or any
 *      identifier that newly appears. Used when (1) is missing OR to
 *      catch identifiers the LLM forgot to enumerate.
 *   3. Directive scan: when the user's directive itself names sections
 *      or identifiers (`"refresh §6"` / `"add SC-Onboarding"`), we
 *      lift those as another seed source.
 *
 * The function is pipeline-mode-agnostic — it operates on the rev-plan
 * outcome regardless of explicit/infer.
 */

// Identifier patterns. Kept symmetric with `extractDependencies.ts` so
// the diff layer's output matches the dependency layer's citations
// without false-positive disambiguation. Bare `§X` markers are NOT
// included — they appear in headings without a doc prefix and would
// land alongside `PRD §X` / `GDD §X` extractions, splitting matches
// (`§6` vs `PRD §6`) and silently dropping affected tasks.
const PATTERNS: RegExp[] = [
  /\b(?:PRD|GDD)\s*§\s*\d+(?:\.\d+)?/g,
  /\bSC-[A-Za-z][\w-]*/g,
  /\bFL-[A-Za-z][\w-]*/g,
  /\bFR-\d+/g,
  /\bCP-[A-Za-z][\w-]*/g,
  /\bRB-[A-Za-z][\w-]*/g,
  /\bEN-[A-Za-z][\w-]*/g,
  /\bCL-[A-Za-z][\w-]*/g,
  /\bMC-[A-Za-z][\w-]*/g,
  /\bLV-[A-Za-z][\w-]*/g,
  /\bRW-[A-Za-z][\w-]*/g,
  /\bGM-[A-Za-z][\w-]*/g,
  /\bMP-[A-Za-z][\w-]*/g,
];

const TAG_RE = /<updated-sections>([\s\S]*?)<\/updated-sections>/i;

export type DiffSource = 'llm-tag' | 'git-diff' | 'directive';

export interface PlanDiff {
  doc: 'prd.md' | 'gdd.md';
  /** Stable identifiers / `§X` markers that changed. Sorted, deduplicated. */
  updatedSections: string[];
  /** Which extraction layer(s) contributed. Always non-empty when `updatedSections` is non-empty. */
  sources: DiffSource[];
}

export interface ExtractPlanDiffInput {
  /** `prd.md` or `gdd.md` — the canonical plan output the rev-plan job rewrote. */
  doc: 'prd.md' | 'gdd.md';
  /** LLM raw response from the rev-plan turn (may contain the `<updated-sections>` tag). */
  llmResponse?: string;
  /** Git unified-diff string for the plan file (e.g. `git diff <ref> -- inputs/sources/prd.md`). */
  gitDiff?: string;
  /** User-supplied directive that drove the rev-plan turn. */
  directive?: string;
}

function normalise(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/\s*§\s*/, ' §').trim();
}

function dedupeSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function extractIds(haystack: string | undefined): string[] {
  if (!haystack) return [];
  const out = new Set<string>();
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(haystack)) !== null) {
      const cleaned = normalise(m[0]);
      if (cleaned) out.add(cleaned);
    }
  }
  return [...out];
}

/**
 * Layer 1 — pull the LLM SSOT tag if present. The tag's body is treated
 * as a comma-or-newline-separated identifier list.
 */
function extractFromLlmTag(llmResponse: string | undefined): string[] {
  if (!llmResponse) return [];
  const m = TAG_RE.exec(llmResponse);
  if (!m) return [];
  const body = m[1];
  // Inside the tag the LLM may have written prose; still grep for
  // identifiers so a partially-conformant emit doesn't lose data.
  return extractIds(body);
}

/**
 * Layer 2 — restrict `git diff` to added/removed lines (those with a
 * leading `+` / `-` but NOT the `+++` / `---` headers) and grep
 * identifiers from them.
 */
function extractFromGitDiff(gitDiff: string | undefined): string[] {
  if (!gitDiff) return [];
  const changed = gitDiff
    .split('\n')
    .filter(line => /^[+-]/.test(line) && !/^[+-]{3}/.test(line))
    .join('\n');
  return extractIds(changed);
}

/**
 * Layer 3 — operator-supplied directive may explicitly name sections.
 */
function extractFromDirective(directive: string | undefined): string[] {
  return extractIds(directive);
}

/**
 * Cascade-merge layers 1 → 2 → 3. The returned `sources[]` records
 * which layer(s) actually contributed, so a downstream UI can show
 * "from LLM" vs "from git diff" provenance and the test can pin
 * which layer matched in each scenario.
 */
export function extractPlanDiff(input: ExtractPlanDiffInput): PlanDiff {
  const llm = extractFromLlmTag(input.llmResponse);
  const git = extractFromGitDiff(input.gitDiff);
  const dir = extractFromDirective(input.directive);

  const sources: DiffSource[] = [];
  if (llm.length) sources.push('llm-tag');
  if (git.length) sources.push('git-diff');
  if (dir.length) sources.push('directive');

  return {
    doc: input.doc,
    updatedSections: dedupeSorted([...llm, ...git, ...dir]),
    sources,
  };
}
