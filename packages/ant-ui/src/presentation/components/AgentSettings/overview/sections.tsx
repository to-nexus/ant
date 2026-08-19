/**
 * Overview section cards — canonical `ConfigEditor/aurora` kit (SectionCard +
 * FieldLabel/AuroraInput). Each yaml-owning card holds exactly ONE definition
 * file through `DefinitionCard`, offering a structured form and the raw YAML
 * over the same buffer; the shell's single ChangedBar saves every dirty file
 * through the definition write funnel. No card owns a Save button.
 *
 * Level model: agent = agent.yaml (AgentDefinitionCard.tsx) · job = job.yaml
 * (name + tools + approval) plus the catalog SUMMARY card (IntentsCard —
 * list/create/navigate only, no file of its own; it maps to the intents/
 * directory) · intent = infer.md (IntentDetailCard.tsx), prompt.md
 * (IntentPromptCard.tsx) and hooks.yaml (IntentHooksCard.tsx), each with its
 * own editing surface. Editing and deleting one intent happens on that
 * intent's own screen, keeping ONE editing surface per file.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Plus, SquareArrowOutUpRight, Target } from 'lucide-react';
import { Button } from '@/presentation/components/aurora';
import { AuroraInput, FieldLabel, SectionCard } from '@/presentation/components/ConfigEditor/aurora';
import { CUSTOM_ID_PATTERN } from '@ant/shared';
import { DefinitionCard } from './DefinitionCard';
import { IdRenameField } from './IdRenameField';
import { McpServersEditor } from './McpServersEditor';
import { ToolChip } from './ToolChip';
import { INTENT_CATALOG_CAP } from './definitionDocs';
import type { UseDefinitionDocsResult } from './useDefinitionDocs';

export interface OverviewCtx {
  level: 'agent' | 'job' | 'intent';
  readonly: boolean;
  docs: UseDefinitionDocsResult;
  builtinToolPreset: string[];
  mutatingBuiltinTools: string[];
  /** MCP server names declared on the job ∪ agent (the hook editor's picker set). */
  mcpServerNames: string[];
}

/** Icon-only row action box — same box metrics as the tree's toolbar icons. */
const ROW_ICON_CLASS =
  'inline-flex items-center justify-center h-5 w-5 shrink-0 rounded text-[color:var(--text-4)] hover:text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition-colors';

const CHIP_TONES = {
  violet: { border: 'var(--violet-300)', fill: 'var(--select-fill-violet)' },
  emerald: {
    border: 'oklch(from var(--emerald-500) l c h / 0.55)',
    fill: 'oklch(from var(--emerald-500) l c h / 0.14)',
  },
  amber: {
    border: 'oklch(from var(--amber-500) l c h / 0.55)',
    fill: 'oklch(from var(--amber-500) l c h / 0.14)',
  },
} as const;

export type ChipTone = keyof typeof CHIP_TONES;

/** Static (non-interactive) counterpart of ChipToggle. */
function StaticChip({ label, tone = 'violet' }: { label: string; tone?: ChipTone }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        padding: '2px 8px',
        borderRadius: 'var(--r-pill)',
        border: `1px solid ${CHIP_TONES[tone].border}`,
        color: 'var(--select-fg)',
        background: CHIP_TONES[tone].fill,
      }}
    >
      {label}
    </span>
  );
}

/** Hook-entry chip label — the YAML vocabulary verbatim, never localized. */
export function stopHookChip(hook: { artifact: string } | { action: string }): { label: string; tone: ChipTone } {
  return 'artifact' in hook
    ? { label: `artifact: ${hook.artifact}`, tone: 'emerald' }
    : { label: `action: ${hook.action}`, tone: 'amber' };
}

// ── Job definition (job.yaml: name + builtin allowlist + approval) ──────────

export function JobDefinitionCard({
  ctx,
  id,
  jobId,
  onRenameId,
}: {
  ctx: OverviewCtx;
  id: string;
  jobId: string;
  /** Resolves once the move landed (or threw) — the shell owns reselection. */
  onRenameId: (newId: string) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const { docs } = ctx;
  const disabled = ctx.readonly || docs.identityDoc?.parseError != null;

  // Vocabulary = the universal preset (tools are job-owned; no agent bound).
  const vocabulary = ctx.builtinToolPreset;
  const effective = new Set(docs.main.toolsBuiltin ?? vocabulary);

  const toggleTool = (tool: string) => {
    const next = new Set(effective);
    if (next.has(tool)) next.delete(tool);
    else next.add(tool);
    // Full selection = key absent (inherit the whole preset).
    docs.setMain({
      toolsBuiltin: next.size === vocabulary.length ? null : vocabulary.filter((v) => next.has(v)),
    });
  };

  const approval = docs.main.approval;

  const setApproval = (tool: string, value: string) => {
    const next = { ...approval };
    if (value === 'default') delete next[tool];
    else next[tool] = value as 'always' | 'never';
    docs.setMain({ approval: next });
  };

  return (
    <DefinitionCard
      id={id}
      icon="Briefcase"
      accent="cool"
      title={t('overview.jobDefinition', 'Job definition')}
      description={t(
        'overview.jobDefinitionDesc',
        'This job’s name, builtin allowlist and MCP servers — the tool list validates directly against the universal preset, and each tool carries its own approval policy. Selecting everything omits the key (full preset).',
      )}
      doc={docs.identityDoc}
      readonly={ctx.readonly}
      onRawChange={(text) => docs.setRaw('main', text)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ maxWidth: 420 }}>
          <FieldLabel>{t('overview.jobName', 'Display name')}</FieldLabel>
          <AuroraInput value={docs.identity.name} disabled={disabled} onChange={(v) => docs.setName(v)} />
        </div>

        <IdRenameField
          label={t('overview.jobId', 'Job id')}
          hint={t(
            'overview.jobIdHint',
            'The id is the job directory name. Changing it moves the directory and this job’s session and plan folders, across all of your workspaces.',
          )}
          currentId={jobId}
          yamlId={docs.identity.id}
          dirtyCount={docs.dirtyCount}
          readonly={ctx.readonly}
          disabled={disabled}
          onRename={onRenameId}
        />

        <div>
          <FieldLabel>{t('overview.tools', 'Tools')}</FieldLabel>
          <p style={{ margin: '0 0 10px', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-3)' }}>
            {t(
              'overview.toolsHint',
              "Click a name to include or exclude the tool; click its state segment to override approval. Mutating tools default to 'always' (call rejected until approved), everything else to 'never'.",
            )}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {vocabulary.map((tool) => (
              <ToolChip
                key={tool}
                tool={tool}
                selected={effective.has(tool)}
                policy={approval[tool]}
                inheritedPolicy={ctx.mutatingBuiltinTools.includes(tool) ? 'always' : 'never'}
                disabled={disabled}
                onToggle={() => toggleTool(tool)}
                onPolicyChange={(v) => setApproval(tool, v)}
              />
            ))}
          </div>
        </div>

        <McpServersEditor servers={docs.mcpServers} disabled={disabled} onChange={docs.setMcpServers} />

        {docs.mcpErrors.length > 0 && (
          <div
            style={{
              fontSize: 11.5,
              borderRadius: 'var(--r-md)',
              padding: '6px 10px',
              background: 'var(--status-error-bg, var(--bg-surface-2))',
              color: 'var(--status-error-fg, var(--text-2))',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {docs.mcpErrors.map((e, i) => (
              <span key={i}>{e}</span>
            ))}
          </div>
        )}
      </div>
    </DefinitionCard>
  );
}

// ── Intents (catalog summary: add + navigate; edit/delete live on the intent screen) ─

export function IntentsCard({
  ctx,
  id,
  onSelectIntent,
  onCreateIntent,
}: {
  ctx: OverviewCtx;
  id: string;
  onSelectIntent: (intentId: string) => void;
  /** Adds a phantom draft and opens its screen so the criteria get authored. */
  onCreateIntent: (intentId: string) => void;
}) {
  const { t } = useTranslation('agents');
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { docs } = ctx;
  const entries = docs.intents;
  // Per-intent files own their errors on their own screens; the summary only
  // gates creation (readonly / catalog cap).
  const disabled = ctx.readonly;
  const atCap = entries.length >= INTENT_CATALOG_CAP;
  const newIdValid = CUSTOM_ID_PATTERN.test(newId) && newId !== 'general' && !entries.some((e) => e.id === newId);

  const toggleExpanded = (intentId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(intentId)) next.delete(intentId);
      else next.add(intentId);
      return next;
    });

  const submitCreate = () => {
    if (!newIdValid) return;
    onCreateIntent(newId);
    setCreating(false);
    setNewId('');
  };

  return (
    <SectionCard
      id={id}
      icon="Split"
      accent="sunset"
      title={t('overview.intents', 'Intents')}
      description={t(
        'overview.intentsHint',
        'Situations this job declares — each intent lives in its own folder under intents/ (infer.md + optional prompt.md and hooks.yaml). Open one to edit its criterion, prompt, and hooks; the agent reads the catalog on every turn.',
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.length === 0 && (
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-4)' }}>
            {t('overview.intentsEmpty', 'No intents — every turn runs on the base prompts alone.')}
          </p>
        )}

        {entries.map((entry) => {
          const isOpen = expanded.has(entry.id);
          const stopHooks = entry.hooks?.stop ?? [];
          return (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--border-1)',
                background: 'var(--bg-surface)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="p-0.5"
                  aria-expanded={isOpen}
                  aria-label={t('overview.intentExpand', 'Show matching criteria')}
                  onClick={() => toggleExpanded(entry.id)}
                  style={{ color: 'var(--text-4)', flexShrink: 0 }}
                >
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <Target size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-1)' }}>
                  {entry.id}
                </span>
                {entry.hasPrompt === true && (
                  <span style={{ fontSize: 10, color: 'var(--text-4)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-pill)', padding: '0 6px' }}>
                    {t('overview.intentHasPrompt', 'prompt')}
                  </span>
                )}
                {/* Navigation is this icon alone — the criteria text is never a link. */}
                <button
                  type="button"
                  className={ROW_ICON_CLASS}
                  title={t('overview.intentOpen', 'Open intent')}
                  aria-label={t('overview.intentOpen', 'Open intent')}
                  onClick={() => onSelectIntent(entry.id)}
                >
                  <SquareArrowOutUpRight size={12} />
                </button>
                <span style={{ flex: 1 }} />
              </div>

              {isOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 27 }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11.5,
                      lineHeight: 1.6,
                      color: 'var(--text-3)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {entry.infer || t('overview.intentNoInfer', 'No matching criteria yet.')}
                  </p>
                  {stopHooks.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10.5, color: 'var(--text-4)' }}>
                        {t('overview.intentHooks', 'Hooks')}
                      </span>
                      {stopHooks.map((hook, i) => {
                        const chip = stopHookChip(hook);
                        return <StaticChip key={i} label={chip.label} tone={chip.tone} />;
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!disabled && !creating && (
          <div>
            <Button size="sm" variant="ghost" disabled={atCap} onClick={() => setCreating(true)}>
              <Plus className="w-3 h-3" /> {t('overview.addIntent', 'Add intent')}
            </Button>
          </div>
        )}
        {!disabled && creating && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitCreate();
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 420 }}
          >
            <div style={{ flex: 1 }}>
              <AuroraInput
                value={newId}
                mono
                hasError={newId.length > 0 && !newIdValid}
                onChange={setNewId}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setNewId('');
                  }
                }}
                placeholder={t('tree.intentId', 'intent-id')}
              />
            </div>
            <Button size="sm" type="submit" disabled={!newIdValid}>
              {t('tree.create', 'Create')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => {
                setCreating(false);
                setNewId('');
              }}
            >
              {t('tree.cancel', 'Cancel')}
            </Button>
          </form>
        )}

        {docs.intentErrors.length > 0 && (
          <div
            style={{
              fontSize: 11.5,
              borderRadius: 'var(--r-md)',
              padding: '6px 10px',
              background: 'var(--status-error-bg, var(--bg-surface-2))',
              color: 'var(--status-error-fg, var(--text-2))',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {docs.intentErrors.map((e, i) => (
              <span key={i}>{e}</span>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
