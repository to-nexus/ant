/**
 * Action-hook field — a picker for one action hook's tool name so authors
 * choose from what can actually satisfy the hook instead of hand-typing:
 * built-ins are offered ONLY from this job's tools.builtin (the loader's H8
 * rule), MCP entries pick a declared server (job ∪ agent) and type the tool
 * name (composing `mcp__{server}__{tool}`), and a Custom escape hatch keeps
 * advanced authoring possible. Satisfiability problems show as non-blocking
 * hints — the BE loader stays the authority.
 */

import { useTranslation } from 'react-i18next';
import { AuroraInput, AuroraSelect } from '@/presentation/components/ConfigEditor/aurora';
import { actionHint, composeMcpAction, isValidMcpAction, parseActionValue } from './actionHook';

const CUSTOM = '__custom__';

export function ActionHookInput({
  value,
  disabled,
  hasError,
  effectiveBuiltins,
  presetBuiltins,
  mcpServerNames,
  onChange,
}: {
  value: string;
  disabled: boolean;
  hasError: boolean;
  /** This job's effective tools.builtin (H8 membership set). */
  effectiveBuiltins: string[];
  /** The full universal preset — distinguishes "excluded here" from "no such tool". */
  presetBuiltins: string[];
  /** MCP server names declared on the job ∪ agent. */
  mcpServerNames: string[];
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation('agents');
  const selection = parseActionValue(value, effectiveBuiltins, mcpServerNames);

  const selectValue =
    selection.source === 'builtin'
      ? `builtin:${selection.tool}`
      : selection.source === 'mcp'
        ? `mcp:${selection.server}`
        : value.trim() === ''
          ? ''
          : CUSTOM;

  const options = [
    ...effectiveBuiltins.map((tool) => ({
      value: `builtin:${tool}`,
      label: tool,
      group: t('intent.actionGroupBuiltin', 'Built-in tools (this job)'),
    })),
    ...mcpServerNames.map((server) => ({
      value: `mcp:${server}`,
      label: `mcp: ${server}`,
      group: t('intent.actionGroupMcp', 'MCP servers'),
    })),
    { value: CUSTOM, label: t('intent.actionSourceCustom', 'Custom…') },
  ];

  const hint = actionHint(value, effectiveBuiltins, presetBuiltins, mcpServerNames);
  // Same frame as the artifact row: a fixed-basis picker followed by the
  // free-text field it reveals, so both kinds line up column for column.
  const hasNameField = selection.source === 'mcp' || selection.source === 'custom';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div style={{ flex: hasNameField ? '0 1 190px' : '1 1 0', minWidth: 0 }}>
          <AuroraSelect
            value={selectValue}
            disabled={disabled}
            hasError={hasError && selectValue === ''}
            placeholder={t('intent.actionPickerPlaceholder', 'Pick the tool this turn must call…')}
            options={options}
            onChange={(v) => {
              if (v === CUSTOM) onChange(value);
              else if (v.startsWith('builtin:')) onChange(v.slice('builtin:'.length));
              else if (v.startsWith('mcp:')) {
                const server = v.slice('mcp:'.length);
                onChange(composeMcpAction(server, selection.source === 'mcp' ? selection.tool : ''));
              }
            }}
          />
        </div>
        {selection.source === 'mcp' && (
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <AuroraInput
              value={selection.tool}
              mono
              disabled={disabled}
              hasError={!isValidMcpAction(value)}
              placeholder={t('intent.actionMcpToolPlaceholder', 'tool-name')}
              onChange={(tool) => onChange(composeMcpAction(selection.server, tool))}
            />
          </div>
        )}
        {selection.source === 'custom' && (
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <AuroraInput
              value={value}
              mono
              disabled={disabled}
              hasError={hasError}
              placeholder={t('intent.hookActionPlaceholder', 'create_file · mcp__server__tool')}
              onChange={onChange}
            />
          </div>
        )}
      </div>
      {selection.source === 'mcp' && (
        <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>
          {composeMcpAction(selection.server, selection.tool || '…')}
        </span>
      )}
      {hint != null && (
        <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--amber-500, var(--text-3))' }}>
          {hint === 'not-in-builtin'
            ? t('intent.hintActionNotInBuiltin', "'{{tool}}' is not in this job's tools.builtin — the hook could never be met. Add the tool to the job or pick another.", { tool: value })
            : hint === 'unknown-server'
              ? t('intent.hintMcpServerUnknown', 'No MCP server "{{server}}" is declared on this job or agent — the hook could never be met.', { server: value.startsWith('mcp__') ? value.slice('mcp__'.length).split('__')[0] : value })
              : t('intent.hintActionUnknownTool', "'{{tool}}' is not a universal builtin tool — saving will be refused unless it is a full mcp__{server}__{tool} name.", { tool: value })}
        </p>
      )}
    </div>
  );
}
