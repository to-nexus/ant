/**
 * Agent-level definition card — the single owner of `agent.yaml`: display
 * name, MCP servers, and the id.
 *
 * The id is the directory name, so changing it is a structural move (the
 * definition dir plus every `sessions/{agentId}` and `artifacts/plan/{agentId}`
 * under the account) — the shared `IdRenameField` owns that interaction, the
 * same one the job card uses for `jobId`.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFINITION_ICON_ACCEPT, DEFINITION_ICON_MAX_BYTES } from '@ant/shared';
import { DefinitionCard } from './DefinitionCard';
import { AuroraInput, CONTROL_MEASURE, FieldHint, FieldLabel } from '@/presentation/components/ConfigEditor/aurora';
import { Button } from '@/presentation/components/aurora';
import { AgentIcon } from '@/presentation/components/AgentIcon';
import { IdRenameField } from './IdRenameField';
import { McpServersEditor } from './McpServersEditor';
import { useFilePicker } from '@/application/hooks/ui/useFilePicker';
import { useStore } from '@/domain/store';
import { deleteAgentIcon, uploadAgentIcon } from '@/infrastructure/http/api/accountAgents';
import { selectAgentIcon } from '@/domain/store/selectors/agentIcon';
import type { OverviewCtx } from './sections';

export function AgentDefinitionCard({
  ctx,
  id,
  agentId,
  onRenameId,
}: {
  ctx: OverviewCtx;
  id: string;
  agentId: string;
  /** Resolves once the move landed (or threw) — the shell owns reselection. */
  onRenameId: (newId: string) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const { docs } = ctx;
  const disabled = ctx.readonly || docs.identityDoc?.parseError != null;

  return (
    <DefinitionCard
      id={id}
      icon="Bot"
      accent="violet-pink"
      title={t('agentDef.title', 'Agent definition')}
      description={t(
        'agentDef.desc',
        'Identity and shared MCP servers for every job of this agent (agent.yaml).',
      )}
      doc={docs.identityDoc}
      readonly={ctx.readonly}
      onRawChange={(text) => docs.setRaw('agent', text)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <AgentIconField agentId={agentId} readonly={ctx.readonly} />

        <div style={{ maxWidth: CONTROL_MEASURE }}>
          <FieldLabel>{t('agentDef.name', 'Display name')}</FieldLabel>
          <AuroraInput value={docs.identity.name} disabled={disabled} onChange={(v) => docs.setName(v)} />
        </div>

        <IdRenameField
          label={t('agentDef.id', 'Agent id')}
          hint={t(
            'agentDef.idHint',
            'The id is the definition directory name. Changing it moves the directory and every session and plan folder keyed by it, across all of your workspaces.',
          )}
          currentId={agentId}
          yamlId={docs.identity.id}
          dirtyCount={docs.dirtyCount}
          readonly={ctx.readonly}
          disabled={disabled}
          onRename={onRenameId}
        />

        <McpServersEditor
          servers={docs.mcpServers}
          apiServers={docs.apiServers}
          disabled={disabled}
          onChange={docs.setMcpServers}
          onApiChange={docs.setApiServers}
        />

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


/**
 * The agent's mark. Unlike every other field on this card it is a FILE, not a
 * yaml key, so it writes immediately rather than on Save — the same immediacy
 * the rail's folder upload has, and the hint says so.
 *
 * There is no dedicated icon endpoint: the icon is a whitelisted definition
 * file, so it rides the one multipart definition lane, which owns the
 * magic-byte sniff, the size cap and the sibling-name unlink.
 */
function AgentIconField({ agentId, readonly }: { agentId: string; readonly: boolean }) {
  const { t } = useTranslation('agents');
  const icon = useStore((s) => selectAgentIcon(s, agentId));
  const loadAccountAgents = useStore((s) => s.loadAccountAgents);
  const loadDefinitionTree = useStore((s) => s.loadDefinitionTree);
  const [pickerNode, openPicker] = useFilePicker();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settle = async () => {
    await loadAccountAgents();
    await loadDefinitionTree(agentId);
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await settle();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <FieldLabel>{t('agentDef.icon', 'Agent icon')}</FieldLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 48,
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-1)',
            borderRadius: 'var(--r-md)',
            flexShrink: 0,
          }}
        >
          <AgentIcon agentId={agentId} size={34} />
        </div>
        {!readonly && (
          <div style={{ display: 'flex', gap: 6 }}>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                openPicker((files) => {
                  const file = files[0];
                  if (file) void run(() => uploadAgentIcon(agentId, file).then(reportSkipped));
                }, { accept: DEFINITION_ICON_ACCEPT })
              }
            >
              {t('agentDef.iconUpload', 'Upload')}
            </Button>
            {icon && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void run(() => deleteAgentIcon(agentId, icon.name))}
              >
                {t('agentDef.iconRemove', 'Remove')}
              </Button>
            )}
          </div>
        )}
      </div>
      <FieldHint>
        {t('agentDef.iconHint', {
          defaultValue:
            'PNG, JPEG or WebP up to {{kb}} KB. Shown wherever this agent appears. Saved immediately — not with the Save button.',
          kb: Math.round(DEFINITION_ICON_MAX_BYTES / 1024),
        })}
      </FieldHint>
      {error && (
        <div style={{ fontSize: 11.5, color: 'var(--status-error-fg, var(--text-2))', marginTop: 4 }}>{error}</div>
      )}
      {pickerNode}
    </div>
  );
}

/**
 * The upload lane answers 200 with a `skipped[]` rather than an error status —
 * a refused icon (wrong bytes, over cap) must not read as a silent success.
 */
function reportSkipped(result: { skipped: Array<{ reason: string }> }): void {
  if (result.skipped.length > 0) throw new Error(result.skipped[0].reason);
}
