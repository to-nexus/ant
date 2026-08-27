/**
 * Action-hook field — a picker for one action hook's tool name so authors
 * choose from what can actually satisfy the hook instead of hand-typing:
 * built-ins are offered ONLY from this job's tools.builtin (the loader's H8
 * rule), while each capability-extension channel offers its declared servers
 * (job ∪ agent) — an MCP entry types the tool name, a declared API picks one
 * of its two synthesized tools. A Custom escape hatch keeps advanced authoring
 * possible. Extension tools need no allowlist: declaring the server is the
 * enablement, so this picker reports what is declared rather than granting it.
 * Satisfiability problems show as non-blocking hints — the BE loader stays the
 * authority.
 */

import { useTranslation } from 'react-i18next';
import { AuroraInput, AuroraSelect, FieldHint } from '@/presentation/components/ConfigEditor/aurora';
import {
  EXTENSION_CHANNELS,
  actionHint,
  channelSpec,
  composeExtensionAction,
  defaultToolFor,
  isValidExtensionAction,
  parseActionValue,
  splitExtensionAction,
  type ExtensionChannel,
  type ExtensionServers,
} from './actionHook';

const CUSTOM = '__custom__';

export function ActionHookInput({
  value,
  disabled,
  hasError,
  effectiveBuiltins,
  presetBuiltins,
  extensionServers,
  onChange,
}: {
  value: string;
  disabled: boolean;
  hasError: boolean;
  /** This job's effective tools.builtin (H8 membership set). */
  effectiveBuiltins: string[];
  /** The full universal preset — distinguishes "excluded here" from "no such tool". */
  presetBuiltins: string[];
  /** Server names per extension channel, declared on the job ∪ agent. */
  extensionServers: ExtensionServers;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation('agents');
  const selection = parseActionValue(value, effectiveBuiltins, extensionServers);

  const selectValue =
    selection.source === 'builtin'
      ? `builtin:${selection.tool}`
      : selection.source === 'extension'
        ? `${selection.channel}:${selection.server}`
        : value.trim() === ''
          ? ''
          : CUSTOM;

  const channelGroupLabel: Record<ExtensionChannel, string> = {
    mcp: t('intent.actionGroupMcp', 'MCP servers'),
    api: t('intent.actionGroupApi', 'API connections'),
  };

  const options = [
    ...effectiveBuiltins.map((tool) => ({
      value: `builtin:${tool}`,
      label: tool,
      group: t('intent.actionGroupBuiltin', 'Built-in tools (this job)'),
    })),
    ...EXTENSION_CHANNELS.flatMap((spec) =>
      extensionServers[spec.channel].map((server) => ({
        value: `${spec.channel}:${server}`,
        label: `${spec.channel}: ${server}`,
        group: channelGroupLabel[spec.channel],
      })),
    ),
    { value: CUSTOM, label: t('intent.actionSourceCustom', 'Custom…') },
  ];

  const hint = actionHint(value, effectiveBuiltins, presetBuiltins, extensionServers);
  const unknownServer =
    hint === 'unknown-mcp-server' || hint === 'unknown-api-server'
      ? (splitExtensionAction(value.trim())?.server ?? value)
      : '';
  // Same frame as the artifact row: a fixed-basis picker followed by the
  // free-text field it reveals, so both kinds line up column for column.
  const hasNameField = selection.source === 'extension' || selection.source === 'custom';
  const toolVocabulary = selection.source === 'extension' ? channelSpec(selection.channel).tools : null;

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
              else {
                const sep = v.indexOf(':');
                const channel = v.slice(0, sep) as ExtensionChannel;
                const server = v.slice(sep + 1);
                // Keep the tool when staying on the same channel; a closed
                // vocabulary otherwise starts on its read-only half.
                const tool =
                  selection.source === 'extension' && selection.channel === channel
                    ? selection.tool
                    : defaultToolFor(channel);
                onChange(composeExtensionAction(channel, server, tool));
              }
            }}
          />
        </div>
        {selection.source === 'extension' && (
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            {toolVocabulary ? (
              <AuroraSelect
                value={selection.tool}
                disabled={disabled}
                hasError={!isValidExtensionAction(selection.channel, value)}
                placeholder={t('intent.actionToolPlaceholder', 'tool-name')}
                options={toolVocabulary.map((tool) => ({ value: tool, label: tool }))}
                onChange={(tool) => onChange(composeExtensionAction(selection.channel, selection.server, tool))}
              />
            ) : (
              <AuroraInput
                value={selection.tool}
                mono
                disabled={disabled}
                hasError={!isValidExtensionAction(selection.channel, value)}
                placeholder={t('intent.actionToolPlaceholder', 'tool-name')}
                onChange={(tool) => onChange(composeExtensionAction(selection.channel, selection.server, tool))}
              />
            )}
          </div>
        )}
        {selection.source === 'custom' && (
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <AuroraInput
              value={value}
              mono
              disabled={disabled}
              hasError={hasError}
              placeholder={t('intent.hookActionPlaceholder', 'create_file · mcp__server__tool · api__server__get')}
              onChange={onChange}
            />
          </div>
        )}
      </div>
      {selection.source === 'extension' && (
        <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>
          {composeExtensionAction(selection.channel, selection.server, selection.tool || '…')}
        </span>
      )}
      {hint != null && (
        <FieldHint tone="warn">
          {hint === 'not-in-builtin'
            ? t('intent.hintActionNotInBuiltin', "'{{tool}}' is not in this job's tools.builtin — the hook could never be met. Add the tool to the job or pick another.", { tool: value })
            : hint === 'unknown-mcp-server'
              ? t('intent.hintMcpServerUnknown', 'No MCP server "{{server}}" is declared on this job or agent — the hook could never be met.', { server: unknownServer })
              : hint === 'unknown-api-server'
                ? t('intent.hintApiServerUnknown', 'No API connection "{{server}}" is declared in apis on this job or agent — the hook could never be met.', { server: unknownServer })
                : t('intent.hintActionUnknownTool', "'{{tool}}' is not a universal builtin tool, an mcp__{server}__{tool} name, or an api__{server}__{get|request} name.", { tool: value })}
        </FieldHint>
      )}
    </div>
  );
}
