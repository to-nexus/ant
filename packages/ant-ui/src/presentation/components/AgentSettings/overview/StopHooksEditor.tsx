/**
 * Hook editor — the structured surface for one intent's `hooks.stop` list
 * (v1's single event: verified when the turn stops). Hooks are structured
 * data (kind + value), edited as rows: a kind select (`artifact` glob /
 * `action` tool name) dispatching to the dedicated value editors —
 * ArtifactGlobInput (location + file-name builder with a natural-language
 * preview) and ActionHookInput (picker over this job's builtins and declared
 * MCP servers) — capped at INTENT_STOP_HOOKS_CAP entries.
 *
 * Every row is the SAME three-column frame regardless of kind — [kind]
 * [value editor] [row actions] — so the trailing controls line up down the
 * list: the raw/builder toggle and the delete button are equal-footprint icon
 * buttons in the trailing cluster, which keeps a fixed width even on rows
 * (action) that have no toggle.
 *
 * Validation here is the shared syntax rule set (`validateStopHookEntry`,
 * no builtin predicate — that judgement stays with the BE save gate, the
 * single authority); rows only mark themselves red, the message list is the
 * card's existing intentErrors block. Satisfiability (H7/H8) mirrors show as
 * non-blocking amber hints.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, Plus, Trash2 } from 'lucide-react';
import { Button, IconButton } from '@/presentation/components/aurora';
import { AuroraSelect, FieldHint } from '@/presentation/components/ConfigEditor/aurora';
import { INTENT_STOP_HOOKS_CAP, validateStopHookEntry, type IntentStopHook } from '@ant/shared';
import { ArtifactGlobInput } from './ArtifactGlobInput';
import { ActionHookInput } from './ActionHookInput';
import { jobLacksArtifactWriter } from './actionHook';

type HookKind = 'artifact' | 'action';

function kindOf(hook: IntentStopHook): HookKind {
  return 'artifact' in hook ? 'artifact' : 'action';
}

function valueOf(hook: IntentStopHook): string {
  return 'artifact' in hook ? hook.artifact : hook.action;
}

function makeHook(kind: HookKind, value: string): IntentStopHook {
  return kind === 'artifact' ? { artifact: value } : { action: value };
}

/** Width of the trailing icon cluster — kept fixed so every row's delete button lands in one column. */
const ROW_ACTIONS_WIDTH = 62;
/** The height of one Aurora control — the trailing icons centre against the first line. */
const CONTROL_ROW_HEIGHT = 36;

function HookRow({
  hook,
  disabled,
  effectiveBuiltins,
  presetBuiltins,
  mcpServerNames,
  onChange,
  onRemove,
}: {
  hook: IntentStopHook;
  disabled: boolean;
  effectiveBuiltins: string[];
  presetBuiltins: string[];
  mcpServerNames: string[];
  onChange: (next: IntentStopHook) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('agents');
  const [rawMode, setRawMode] = useState(false);

  const kind = kindOf(hook);
  const value = valueOf(hook);
  // Non-empty rows carry the shared syntax judgement; an empty row is
  // "being typed", so only the save gate complains about it.
  const rowError = value.trim().length > 0 && validateStopHookEntry(hook).error != null;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div style={{ width: 118, flexShrink: 0 }}>
        <AuroraSelect
          value={kind}
          disabled={disabled}
          options={[
            { value: 'artifact', label: t('intent.hookKindArtifact', 'artifact') },
            { value: 'action', label: t('intent.hookKindAction', 'action') },
          ]}
          onChange={(v) => onChange(makeHook(v as HookKind, ''))}
        />
      </div>
      {kind === 'artifact' ? (
        <ArtifactGlobInput
          value={value}
          disabled={disabled}
          hasError={rowError}
          rawMode={rawMode}
          onChange={(v) => onChange(makeHook(kind, v))}
        />
      ) : (
        <ActionHookInput
          value={value}
          disabled={disabled}
          hasError={rowError}
          effectiveBuiltins={effectiveBuiltins}
          presetBuiltins={presetBuiltins}
          mcpServerNames={mcpServerNames}
          onChange={(v) => onChange(makeHook(kind, v))}
        />
      )}
      <div
        style={{
          width: ROW_ACTIONS_WIDTH,
          height: CONTROL_ROW_HEIGHT,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 2,
        }}
      >
        {kind === 'artifact' && (
          <IconButton
            size="sm"
            icon={<Braces size={13} />}
            active={rawMode}
            title={rawMode ? t('intent.globModeBuilder', 'Builder') : t('intent.globModeRaw', 'Raw')}
            aria-label={rawMode ? t('intent.globModeBuilder', 'Builder') : t('intent.globModeRaw', 'Raw')}
            onClick={() => setRawMode((m) => !m)}
          />
        )}
        {!disabled && (
          <IconButton
            size="sm"
            icon={<Trash2 size={13} />}
            title={t('intent.removeHook', 'Remove hook')}
            aria-label={t('intent.removeHook', 'Remove hook')}
            onClick={onRemove}
          />
        )}
      </div>
    </div>
  );
}

export function StopHooksEditor({
  hooks,
  disabled,
  effectiveBuiltins,
  mcpServerNames,
  presetBuiltins,
  onChange,
}: {
  hooks: IntentStopHook[];
  disabled: boolean;
  /** This job's effective tools.builtin — the action picker's vocabulary and the H7/H8 hint basis. */
  effectiveBuiltins: string[];
  /** MCP server names declared on the job ∪ agent. */
  mcpServerNames: string[];
  /** The full universal preset (hint wording only). */
  presetBuiltins: string[];
  /** The full next `stop` list; empty = remove the intent's hooks.yaml. */
  onChange: (stop: IntentStopHook[]) => void;
}) {
  const { t } = useTranslation('agents');

  const replaceAt = (i: number, next: IntentStopHook) =>
    onChange(hooks.map((h, j) => (j === i ? next : h)));

  const hasArtifactHook = hooks.some((h) => 'artifact' in h);

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {hooks.length === 0 && (
          <FieldHint tone="muted">
            {t('intent.hooksNone', 'No hooks — the turn ends when the agent stops.')}
          </FieldHint>
        )}
        {hooks.map((hook, i) => (
          <HookRow
            key={i}
            hook={hook}
            disabled={disabled}
            effectiveBuiltins={effectiveBuiltins}
            presetBuiltins={presetBuiltins}
            mcpServerNames={mcpServerNames}
            onChange={(next) => replaceAt(i, next)}
            onRemove={() => onChange(hooks.filter((_, j) => j !== i))}
          />
        ))}
        {!disabled && (
          <div>
            <Button
              size="sm"
              variant="ghost"
              disabled={hooks.length >= INTENT_STOP_HOOKS_CAP}
              onClick={() => onChange([...hooks, { artifact: '' }])}
            >
              <Plus className="w-3 h-3" /> {t('intent.addHook', 'Add hook')}
            </Button>
          </div>
        )}

        {hasArtifactHook && jobLacksArtifactWriter(effectiveBuiltins) && (
          <FieldHint tone="warn">
            {t(
              'intent.hintArtifactNoWriter',
              "This job's tool list has no file-writing tool (create_file / edit_file / append_file / copy_file) — an artifact hook could never be met.",
            )}
          </FieldHint>
        )}

        {hasArtifactHook && (
          <FieldHint tone="muted">
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>*</span>{' '}
            {t('intent.globStarHint', '* matches any characters within one path segment')}
            {' · '}
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>**</span>{' '}
            {t('intent.globGlobstarHint', '** matches any depth — valid only as a whole segment')}
          </FieldHint>
        )}
      </div>
      <FieldHint spacing="above">
        {t(
          'intent.hooksHint',
          "Every entry must hold when the turn stops — the stop event — verified from actual tool results (AND), never from the model's claims. An artifact glob must match a real file write this turn; an action names a tool that must have been successfully called. Unmet hooks re-prompt the agent a bounded number of times, then pause the job resumably.",
        )}
      </FieldHint>
    </div>
  );
}
