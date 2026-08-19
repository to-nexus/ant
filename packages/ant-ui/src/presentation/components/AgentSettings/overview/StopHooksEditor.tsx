/**
 * Hook editor — the structured surface for one intent's `hooks.stop` list
 * (v1's single event: verified when the turn stops). Hooks are structured
 * data (kind + value), edited as rows: a kind select (`artifact` glob /
 * `action` tool name) dispatching to the dedicated value editors —
 * ArtifactGlobInput (segment builder + natural-language preview) and
 * ActionHookInput (picker over this job's builtins and declared MCP servers)
 * — capped at INTENT_STOP_HOOKS_CAP entries.
 *
 * Validation here is the shared syntax rule set (`validateStopHookEntry`,
 * no builtin predicate — that judgement stays with the BE save gate, the
 * single authority); rows only mark themselves red, the message list is the
 * card's existing intentErrors block. Satisfiability (H7/H8) mirrors show as
 * non-blocking amber hints.
 */

import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/presentation/components/aurora';
import { AuroraSelect } from '@/presentation/components/ConfigEditor/aurora';
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
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-4)' }}>
            {t('intent.hooksNone', 'No hooks — the turn ends when the agent stops.')}
          </p>
        )}
        {hooks.map((hook, i) => {
          const kind = kindOf(hook);
          const value = valueOf(hook);
          // Non-empty rows carry the shared syntax judgement; an empty row is
          // "being typed", so only the save gate complains about it.
          const rowError = value.trim().length > 0 && validateStopHookEntry(hook).error != null;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ width: 118, flexShrink: 0 }}>
                <AuroraSelect
                  value={kind}
                  disabled={disabled}
                  options={[
                    { value: 'artifact', label: t('intent.hookKindArtifact', 'artifact') },
                    { value: 'action', label: t('intent.hookKindAction', 'action') },
                  ]}
                  onChange={(v) => replaceAt(i, makeHook(v as HookKind, ''))}
                />
              </div>
              {kind === 'artifact' ? (
                <ArtifactGlobInput
                  value={value}
                  disabled={disabled}
                  hasError={rowError}
                  onChange={(v) => replaceAt(i, makeHook(kind, v))}
                />
              ) : (
                <ActionHookInput
                  value={value}
                  disabled={disabled}
                  hasError={rowError}
                  effectiveBuiltins={effectiveBuiltins}
                  presetBuiltins={presetBuiltins}
                  mcpServerNames={mcpServerNames}
                  onChange={(v) => replaceAt(i, makeHook(kind, v))}
                />
              )}
              {!disabled && (
                <button
                  type="button"
                  className="inline-flex items-center justify-center h-5 w-5 shrink-0 rounded text-[color:var(--text-4)] hover:text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition-colors"
                  style={{ marginTop: 8 }}
                  title={t('intent.removeHook', 'Remove hook')}
                  aria-label={t('intent.removeHook', 'Remove hook')}
                  onClick={() => onChange(hooks.filter((_, j) => j !== i))}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
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
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--amber-500, var(--text-3))' }}>
            {t(
              'intent.hintArtifactNoWriter',
              "This job's tool list has no file-writing tool (create_file / edit_file / append_file / copy_file) — an artifact hook could never be met.",
            )}
          </p>
        )}

        {hasArtifactHook && (
          <p style={{ margin: 0, fontSize: 10.5, lineHeight: 1.6, color: 'var(--text-4)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>*</span>{' '}
            {t('intent.globStarHint', '* matches any characters within one path segment')}
            {' · '}
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>**</span>{' '}
            {t('intent.globGlobstarHint', '** matches any depth — valid only as a whole segment')}
          </p>
        )}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-3)' }}>
        {t(
          'intent.hooksHint',
          "Every entry must hold when the turn stops — the stop event — verified from actual tool results (AND), never from the model's claims. An artifact glob must match a real file write this turn; an action names a tool that must have been successfully called. Unmet hooks re-prompt the agent a bounded number of times, then pause the job resumably.",
        )}
      </p>
    </div>
  );
}
