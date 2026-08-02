/**
 * System Default Models — SSOT
 *
 * Two orthogonal decisions, deliberately owned by different layers:
 *
 *   1. tier → concrete model id   ("anthropic:opus" → "claude-opus-5")
 *      Owned by CODE (`MODEL_REGISTRY.tier` / `DEFAULT_MODELS` in @ant/shared).
 *      It changes when a provider ships a model, which is a code update.
 *
 *   2. job/node default → tier    ("code.decompose" → "anthropic:opus")
 *      Owned by THIS module, overridable per slot by env. It is a deployment
 *      choice — swap the code job onto GLM, or commit messages onto Haiku —
 *      and must not require a rebuild.
 *
 * Env var per slot: `ANT_DEFAULT_MODEL_<JOB>[_<NODE>]`, value `"<provider>:<tier>"`
 * (an ABSTRACT model, never a concrete id — pinning an id is decision 1's job).
 * Names are derived from {@link DEFAULT_BINDINGS} by {@link envVarForSlot}, so a new
 * slot gets its variable with no second place to edit.
 *
 *   ANT_DEFAULT_MODEL_CODE=glm:flagship              # code job default
 *   ANT_DEFAULT_MODEL_CODE_DECOMPOSE=anthropic:opus  # one node of it
 *   ANT_DEFAULT_MODEL_COMMIT=anthropic:haiku         # auxiliary commit-message call
 *   ANT_DEFAULT_MODEL_FALLBACK=anthropic:opus        # nothing-else-resolved fallback
 *
 * An unparseable / unknown / capability-violating value is WARNED and ignored in
 * favour of the built-in binding: a typo must not brick a deployment, and a silent
 * substitution would be worse than a loud fallback.
 *
 * All callers MUST go through this module. Never read `ANT_DEFAULT_MODEL_*` elsewhere.
 */

import {
  DEFAULT_MODELS,
  IMAGE_GEN_SLOTS,
  MODEL_REGISTRY,
  type ModelNodeKey,
  type ModelProvider,
} from '@ant/shared';
import type { LLMModels } from '../types/workspace';

/** A binding target: one provider's abstract model, `"<provider>:<tier>"`. */
type TierRef = string;

/** Every slot that carries a default, including the non-graph `commit` aux key. */
type BindingJobKey = keyof LLMModels;

/**
 * THE role→tier binding table. Each entry names an abstract model; the concrete id
 * comes from `DEFAULT_MODELS` at resolve time. This is the single owner — the
 * creation snapshot, the load-time merge base, the config heal and the API fallback
 * all derive from it, which is what keeps a slot (historically `commit`) from being
 * present in some copies and missing in others.
 */
const DEFAULT_BINDINGS: Record<BindingJobKey, Partial<Record<ModelNodeKey, TierRef>>> = {
  design: {
    default: 'anthropic:sonnet',
    decompose: 'anthropic:sonnet',
    plan: 'anthropic:opus',
    execute: 'anthropic:sonnet',
  },
  code: {
    default: 'anthropic:sonnet',
    decompose: 'anthropic:opus',
    plan: 'anthropic:sonnet',
    execute: 'anthropic:sonnet',
  },
  learn: { default: 'anthropic:sonnet' },
  // plan job splits into plan (observe/clarify/seal) + execute (author): the plan
  // node reasons over the codebase → opus; execute authors from the sealed brief.
  plan: {
    default: 'anthropic:sonnet',
    plan: 'anthropic:opus',
    execute: 'anthropic:sonnet',
  },
  visual: {
    default: 'google:flash',
    direct: 'google:pro',
    explain: 'google:pro',
    engrave: 'google:pro',
    sketch: 'google:flashImage',
    render: 'google:proImage',
  },
  reviewer: { default: 'anthropic:opus' },
  doc: { default: 'anthropic:opus' },
  commit: { default: 'anthropic:sonnet' },
};

/**
 * Global fallback for `resolveModelForContext` when a context resolves to no slot at
 * all. Declared as a named slot so the three call sites point at something explicit
 * rather than re-picking a tier each.
 */
const FALLBACK_BINDING: TierRef = 'anthropic:opus';

const SCREAM = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

/** Env var for one binding slot. `node === 'default'` yields the bare job form. */
export function envVarForSlot(job: BindingJobKey, node: ModelNodeKey = 'default'): string {
  const suffix = node === 'default' ? SCREAM(job) : `${SCREAM(job)}_${SCREAM(node)}`;
  return `ANT_DEFAULT_MODEL_${suffix}`;
}

/** Env var for the global fallback slot. */
export const FALLBACK_ENV_VAR = 'ANT_DEFAULT_MODEL_FALLBACK';

/** Slots that must resolve to an image-generation model (SSOT: `IMAGE_GEN_SLOTS`). */
function requiresImageModel(job: BindingJobKey, node: ModelNodeKey): boolean {
  return (IMAGE_GEN_SLOTS[job as keyof typeof IMAGE_GEN_SLOTS] ?? []).includes(node);
}

/** Resolve `"<provider>:<tier>"` to a concrete id, or `undefined` with a reason. */
function resolveTierRef(ref: string): { id?: string; reason?: string } {
  const [provider, tier, ...rest] = ref.trim().split(':');
  if (!provider || !tier || rest.length) {
    return { reason: `expected "<provider>:<tier>", got "${ref}"` };
  }
  const byTier = DEFAULT_MODELS[provider as ModelProvider];
  if (!byTier) {
    return { reason: `unknown provider "${provider}" (known: ${Object.keys(DEFAULT_MODELS).join(', ')})` };
  }
  const id = byTier[tier];
  if (!id) {
    return { reason: `provider "${provider}" has no tier "${tier}" (known: ${Object.keys(byTier).join(', ')})` };
  }
  return { id };
}

/** Resolve one slot: env binding → built-in binding, both via the tier map. */
function resolveSlot(job: BindingJobKey, node: ModelNodeKey, builtin: TierRef): string {
  const envVar = envVarForSlot(job, node);
  const raw = process.env[envVar]?.trim();

  if (raw) {
    const { id, reason } = resolveTierRef(raw);
    if (!id) {
      console.warn(`⚠️  [DefaultModels] ${envVar}="${raw}" ignored — ${reason}.`);
    } else if (requiresImageModel(job, node) && !MODEL_REGISTRY[id]?.capabilities?.includes('image-generation')) {
      // A text model here reaches GeminiImageClient and fails at render time —
      // far from the misconfiguration. Reject at resolve time instead.
      console.warn(
        `⚠️  [DefaultModels] ${envVar}="${raw}" ignored — ${job}.${node} needs an ` +
          `image-generation model, and "${id}" is not one.`,
      );
    } else {
      return id;
    }
  }

  const { id, reason } = resolveTierRef(builtin);
  if (!id) throw new Error(`[DefaultModels] built-in binding ${job}.${node}="${builtin}" is invalid — ${reason}`);
  return id;
}

/**
 * The full job × node default `llmModels` table with env bindings applied — the
 * single source every default-writing surface derives from.
 */
export function getDefaultLlmModels(): LLMModels {
  const out: LLMModels = {};
  for (const [job, nodes] of Object.entries(DEFAULT_BINDINGS) as [BindingJobKey, Partial<Record<ModelNodeKey, TierRef>>][]) {
    const resolved: Record<string, string> = {};
    for (const [node, ref] of Object.entries(nodes) as [ModelNodeKey, TierRef][]) {
      resolved[node] = resolveSlot(job, node, ref);
    }
    out[job] = resolved;
  }
  return out;
}

/**
 * Job-level defaults only — the load-time merge base. Derived by dropping node keys
 * so a user who customized only `job.default` genuinely falls through to it for every
 * node (see `getConfigMergeDefaults`); keeping this derivation mechanical is what
 * stops the merge base from drifting away from the creation snapshot.
 */
export function getDefaultJobModels(): LLMModels {
  const full = getDefaultLlmModels();
  const out: LLMModels = {};
  for (const [job, cfg] of Object.entries(full) as [BindingJobKey, Record<string, string>][]) {
    if (cfg?.default) out[job] = { default: cfg.default };
  }
  return out;
}

/** Model used when a context resolves to no configured slot at all. */
export function getFallbackModel(): string {
  const raw = process.env[FALLBACK_ENV_VAR]?.trim();
  if (raw) {
    const { id, reason } = resolveTierRef(raw);
    if (id) return id;
    console.warn(`⚠️  [DefaultModels] ${FALLBACK_ENV_VAR}="${raw}" ignored — ${reason}.`);
  }
  return resolveTierRef(FALLBACK_BINDING).id!;
}

/** Every env var this module reads, for docs/example cross-checks and tests. */
export function listBindingEnvVars(): string[] {
  const vars = [FALLBACK_ENV_VAR];
  for (const [job, nodes] of Object.entries(DEFAULT_BINDINGS) as [BindingJobKey, Partial<Record<ModelNodeKey, TierRef>>][]) {
    for (const node of Object.keys(nodes) as ModelNodeKey[]) vars.push(envVarForSlot(job, node));
  }
  return vars;
}

/** Built-in bindings, for tests and docs generation. Not for runtime resolution. */
export function listDefaultBindings(): ReadonlyArray<{ job: BindingJobKey; node: ModelNodeKey; ref: TierRef; envVar: string }> {
  const rows: { job: BindingJobKey; node: ModelNodeKey; ref: TierRef; envVar: string }[] = [];
  for (const [job, nodes] of Object.entries(DEFAULT_BINDINGS) as [BindingJobKey, Partial<Record<ModelNodeKey, TierRef>>][]) {
    for (const [node, ref] of Object.entries(nodes) as [ModelNodeKey, TierRef][]) {
      rows.push({ job, node, ref, envVar: envVarForSlot(job, node) });
    }
  }
  return rows;
}
