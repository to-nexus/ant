/**
 * Overview section cards — canonical `ConfigEditor/aurora` kit (SectionCard +
 * FieldLabel/AuroraInput/AuroraSelect). Cards mutate the shared
 * `useDefinitionDocs` drafts; the shell's single ChangedBar saves every dirty
 * file through the definition write funnel. No card owns a Save button.
 *
 * Level model: cards exist only where a form field does — job = tools +
 * intents summary; intent = its own detail card (IntentDetailCard.tsx). The
 * agent level has no cards (identity is base/*.md prose; renames live in the
 * tree kebab). IntentsCard is a summary list that links into the intent
 * selection, keeping ONE editing surface per intent.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Target } from 'lucide-react';
import { Button } from '@/presentation/components/aurora';
import {
  AuroraInput,
  AuroraSelect,
  FieldLabel,
  SectionCard,
} from '@/presentation/components/ConfigEditor/aurora';
import { CUSTOM_ID_PATTERN } from '@ant/shared';
import type { UseDefinitionDocsResult } from './useDefinitionDocs';

export interface OverviewCtx {
  level: 'agent' | 'job' | 'intent';
  readonly: boolean;
  docs: UseDefinitionDocsResult;
  builtinToolPreset: string[];
  mutatingBuiltinTools: string[];
}

/** Pill-toggle used for tool selection and injection binding. */
export function ChipToggle({
  label,
  selected,
  disabled,
  onToggle,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      style={{
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        padding: '3px 10px',
        borderRadius: 'var(--r-pill)',
        border: `1px solid ${selected ? 'var(--violet-300)' : 'var(--border-2)'}`,
        background: selected ? 'var(--select-fill-violet)' : 'var(--bg-surface)',
        color: selected ? 'var(--select-fg)' : 'var(--text-3)',
        fontWeight: selected ? 700 : 500,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && !selected ? 0.55 : 1,
        transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
      }}
    >
      {label}
    </button>
  );
}

// ── Tools (job-only: builtin allowlist + approval overrides) ─────────────────

export function ToolsCard({ ctx, id }: { ctx: OverviewCtx; id: string }) {
  const { t } = useTranslation('agents');
  const draft = ctx.docs.draft;
  const [addingOverride, setAddingOverride] = useState('');
  if (!draft) return null;

  // Vocabulary = the universal preset (tools are job-owned; no agent bound).
  const vocabulary = ctx.builtinToolPreset;
  const effective = new Set(draft.main.toolsBuiltin ?? vocabulary);

  const toggleTool = (tool: string) => {
    const next = new Set(effective);
    if (next.has(tool)) next.delete(tool);
    else next.add(tool);
    // Full selection = key absent (inherit the whole preset).
    ctx.docs.setMain({
      toolsBuiltin: next.size === vocabulary.length ? null : vocabulary.filter((v) => next.has(v)),
    });
  };

  const approval = draft.main.approval;
  const approvalRows = vocabulary.filter(
    (tool) => ctx.mutatingBuiltinTools.includes(tool) || approval[tool] !== undefined,
  );
  const overrideCandidates = vocabulary.filter((tool) => !approvalRows.includes(tool));

  const setApproval = (tool: string, value: string) => {
    const next = { ...approval };
    if (value === 'default') delete next[tool];
    else next[tool] = value as 'always' | 'never';
    ctx.docs.setMain({ approval: next });
  };

  return (
    <SectionCard
      id={id}
      icon="Wrench"
      accent="cool"
      title={t('overview.tools', 'Tools')}
      description={t('overview.toolsJobDesc', 'This job’s builtin allowlist — validates directly against the universal preset. Selecting everything omits the key (full preset).')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {vocabulary.map((tool) => (
            <ChipToggle
              key={tool}
              label={tool}
              selected={effective.has(tool)}
              disabled={ctx.readonly}
              onToggle={() => toggleTool(tool)}
            />
          ))}
        </div>

        <div>
          <FieldLabel>{t('overview.approval', 'Approval overrides')}</FieldLabel>
          <p style={{ margin: '0 0 10px', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-3)' }}>
            {t(
              'overview.approvalHint',
              "Mutating tools default to 'always' (call rejected until approved); everything else to 'never'. Declare 'never' here to pre-approve a mutating tool.",
            )}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 420 }}>
            {approvalRows.map((tool) => {
              const isMutating = ctx.mutatingBuiltinTools.includes(tool);
              return (
                <div key={tool} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-2)',
                    }}
                  >
                    {tool}
                  </span>
                  <div style={{ width: 180 }}>
                    <AuroraSelect
                      value={approval[tool] ?? 'default'}
                      disabled={ctx.readonly}
                      onChange={(v) => setApproval(tool, v)}
                      options={[
                        {
                          value: 'default',
                          label: `${t('overview.approvalDefault', 'default')} (${isMutating ? 'always' : 'never'})`,
                        },
                        { value: 'always', label: 'always' },
                        { value: 'never', label: 'never' },
                      ]}
                    />
                  </div>
                </div>
              );
            })}
            {!ctx.readonly && overrideCandidates.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <AuroraSelect
                    value={addingOverride}
                    onChange={(v) => {
                      setAddingOverride('');
                      if (v) setApproval(v, 'never');
                    }}
                    placeholder={t('overview.approvalAdd', 'Add override for a tool…')}
                    options={overrideCandidates.map((tool) => ({ value: tool, label: tool }))}
                  />
                </div>
                <div style={{ width: 180 }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

// ── Intents (summary list — the editing surface is the intent detail) ────────

export function IntentsCard({
  ctx,
  id,
  onSelectIntent,
  onCreateIntent,
}: {
  ctx: OverviewCtx;
  id: string;
  onSelectIntent: (intentId: string) => void;
  onCreateIntent: (intentId: string) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const draft = ctx.docs.draft;
  if (!draft) return null;
  const entries = draft.intents;
  const newIdValid = CUSTOM_ID_PATTERN.test(newId) && newId !== 'general' && !entries.some((e) => e.id === newId);

  const submitCreate = async () => {
    if (!newIdValid) return;
    await onCreateIntent(newId);
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
        'Ways this job classifies an incoming request. Select one to edit its matching criteria and prompts.',
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.length === 0 && (
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-4)' }}>
            {t('overview.intentsEmpty', 'No intents — classification is skipped entirely at zero cost until you add one.')}
          </p>
        )}

        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelectIntent(entry.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border-1)',
              background: 'var(--bg-surface)',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <Target size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-1)' }}>
              {entry.id}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 11.5,
                color: 'var(--text-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.description}
            </span>
            {(entry.injections ?? []).length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  padding: '1px 7px',
                  borderRadius: 'var(--r-pill)',
                  border: '1px solid var(--violet-300)',
                  color: 'var(--select-fg)',
                  background: 'var(--select-fill-violet)',
                  flexShrink: 0,
                }}
              >
                {(entry.injections ?? []).length}
              </span>
            )}
          </button>
        ))}

        {!ctx.readonly && !creating && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
              <Plus className="w-3 h-3" /> {t('overview.addIntent', 'Add intent')}
            </Button>
          </div>
        )}
        {!ctx.readonly && creating && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitCreate();
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

        {ctx.docs.intentErrors.length > 0 && (
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
            {ctx.docs.intentErrors.map((e, i) => (
              <span key={i}>{e}</span>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
