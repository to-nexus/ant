/**
 * Agent-level definition card — the single owner of `agent.yaml`: display
 * name, MCP servers, and the id.
 *
 * The id is the directory name, so changing it is a structural move (the
 * definition dir plus every `sessions/{agentId}` and `artifacts/plan/{agentId}`
 * under the account) — the shared `IdRenameField` owns that interaction, the
 * same one the job card uses for `jobId`.
 */

import { useTranslation } from 'react-i18next';
import { DefinitionCard } from './DefinitionCard';
import { AuroraInput, CONTROL_MEASURE, FieldLabel } from '@/presentation/components/ConfigEditor/aurora';
import { IdRenameField } from './IdRenameField';
import { McpServersEditor } from './McpServersEditor';
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
