/**
 * Structured `mcp.servers` editor — shared by the agent and job definition
 * cards (both yaml files carry the same block; the job's entry wins on a name
 * collision at load time). It mutates the card's own document through
 * `useDefinitionDocs.setMcpServers`, so the YAML view is the same buffer and
 * the shell's ChangedBar owns saving.
 *
 * `args` and `env` are row-per-entry rather than one delimited field: an arg
 * may legitimately contain spaces or commas, so any split rule would be a
 * guess. Transport picks the field set — http shows only `url`, because the
 * connection manager ignores command/args/env there.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { MCP_ENV_VAR_NAME_PATTERN, isValidCustomId, type McpServerConfig } from '@ant/shared';
import { Button } from '@/presentation/components/aurora';
import { AuroraInput, AuroraSelect, FieldLabel } from '@/presentation/components/ConfigEditor/aurora';

const ICON_BTN =
  'inline-flex items-center justify-center h-6 w-6 shrink-0 rounded text-[color:var(--text-4)] hover:text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition-colors';

/** Rename a key without losing its position — server order is the file's order. */
function renameKey(
  servers: Record<string, McpServerConfig>,
  from: string,
  to: string,
): Record<string, McpServerConfig> {
  return Object.fromEntries(Object.entries(servers).map(([k, v]) => [k === from ? to : k, v]));
}

function RowLabel({ children }: { children: string }) {
  return (
    <span
      style={{
        width: 68,
        flexShrink: 0,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-4)',
        paddingTop: 8,
      }}
    >
      {children}
    </span>
  );
}

export function McpServersEditor({
  servers,
  disabled,
  onChange,
}: {
  servers: Record<string, McpServerConfig>;
  disabled: boolean;
  onChange: (next: Record<string, McpServerConfig>) => void;
}) {
  const { t } = useTranslation('agents');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const names = Object.keys(servers);
  const newNameValid = isValidCustomId(newName) && !names.includes(newName);

  const patch = (name: string, next: Partial<McpServerConfig>) =>
    onChange({ ...servers, [name]: { ...servers[name], ...next } });

  const submitAdd = () => {
    if (!newNameValid) return;
    onChange({ ...servers, [newName]: { transport: 'stdio', command: '' } });
    setAdding(false);
    setNewName('');
  };

  return (
    <div>
      <FieldLabel optional>{t('agentDef.mcpServers', 'MCP servers')}</FieldLabel>
      <p style={{ margin: '0 0 10px', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-3)' }}>
        {t('agentDef.mcpHint', 'env values are host variable NAMES, never secrets — the value is looked up in the host environment when the server starts.')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {names.length === 0 && !adding && (
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-4)' }}>
            {t('agentDef.mcpEmpty', 'None declared.')}
          </p>
        )}

        {names.map((name) => {
          const cfg = servers[name];
          const args = cfg.args ?? [];
          const env = Object.entries(cfg.env ?? {});
          return (
            <div
              key={name}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--border-1)',
                background: 'var(--bg-surface)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <AuroraInput
                    value={name}
                    mono
                    disabled={disabled}
                    hasError={!isValidCustomId(name)}
                    onChange={(v) => onChange(renameKey(servers, name, v))}
                  />
                </div>
                <div style={{ width: 130 }}>
                  <AuroraSelect
                    value={cfg.transport ?? ''}
                    disabled={disabled}
                    onChange={(v) => patch(name, { transport: v as McpServerConfig['transport'] })}
                    placeholder={t('agentDef.mcpTransport', 'transport…')}
                    options={[
                      { value: 'stdio', label: 'stdio' },
                      { value: 'http', label: 'http' },
                    ]}
                  />
                </div>
                {!disabled && (
                  <button
                    type="button"
                    className={ICON_BTN}
                    title={t('agentDef.mcpRemove', 'Remove server')}
                    aria-label={t('agentDef.mcpRemove', 'Remove server')}
                    onClick={() =>
                      onChange(Object.fromEntries(Object.entries(servers).filter(([k]) => k !== name)))
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {cfg.transport === 'http' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <RowLabel>url</RowLabel>
                  <div style={{ flex: 1 }}>
                    <AuroraInput
                      value={cfg.url ?? ''}
                      mono
                      disabled={disabled}
                      onChange={(v) => patch(name, { url: v })}
                      placeholder="https://…"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <RowLabel>command</RowLabel>
                    <div style={{ flex: 1 }}>
                      <AuroraInput
                        value={cfg.command ?? ''}
                        mono
                        disabled={disabled}
                        onChange={(v) => patch(name, { command: v })}
                        placeholder="npx"
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <RowLabel>args</RowLabel>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {args.map((arg, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1 }}>
                            <AuroraInput
                              value={arg}
                              mono
                              disabled={disabled}
                              onChange={(v) =>
                                patch(name, { args: args.map((a, j) => (j === i ? v : a)) })
                              }
                            />
                          </div>
                          {!disabled && (
                            <button
                              type="button"
                              className={ICON_BTN}
                              aria-label={t('agentDef.mcpRemoveArg', 'Remove argument')}
                              onClick={() => patch(name, { args: args.filter((_, j) => j !== i) })}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                      {!disabled && (
                        <div>
                          <Button size="sm" variant="ghost" onClick={() => patch(name, { args: [...args, ''] })}>
                            <Plus className="w-3 h-3" /> {t('agentDef.mcpAddArg', 'Add argument')}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <RowLabel>env</RowLabel>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {env.map(([key, value], i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1 }}>
                            <AuroraInput
                              value={key}
                              mono
                              disabled={disabled}
                              onChange={(v) =>
                                patch(name, {
                                  env: Object.fromEntries(
                                    env.map(([k, val], j) => (j === i ? [v, val] : [k, val])),
                                  ),
                                })
                              }
                            />
                          </div>
                          <span style={{ color: 'var(--text-4)', fontSize: 12 }}>→</span>
                          <div style={{ flex: 1 }}>
                            <AuroraInput
                              value={value}
                              mono
                              disabled={disabled}
                              hasError={!MCP_ENV_VAR_NAME_PATTERN.test(value)}
                              onChange={(v) =>
                                patch(name, {
                                  env: Object.fromEntries(
                                    env.map(([k, val], j) => (j === i ? [k, v] : [k, val])),
                                  ),
                                })
                              }
                              placeholder="HOST_ENV_VAR"
                            />
                          </div>
                          {!disabled && (
                            <button
                              type="button"
                              className={ICON_BTN}
                              aria-label={t('agentDef.mcpRemoveEnv', 'Remove variable')}
                              onClick={() =>
                                patch(name, {
                                  env: Object.fromEntries(env.filter((_, j) => j !== i)),
                                })
                              }
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                      {!disabled && (
                        <div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => patch(name, { env: { ...(cfg.env ?? {}), '': '' } })}
                          >
                            <Plus className="w-3 h-3" /> {t('agentDef.mcpAddEnv', 'Add variable')}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {!disabled && !adding && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <Plus className="w-3 h-3" /> {t('agentDef.mcpAddServer', 'Add server')}
            </Button>
          </div>
        )}
        {!disabled && adding && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitAdd();
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 420 }}
          >
            <div style={{ flex: 1 }}>
              <AuroraInput
                value={newName}
                mono
                hasError={newName.length > 0 && !newNameValid}
                onChange={setNewName}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setAdding(false);
                    setNewName('');
                  }
                }}
                placeholder={t('agentDef.mcpServerName', 'server-name')}
              />
            </div>
            <Button size="sm" type="submit" disabled={!newNameValid}>
              {t('tree.create', 'Create')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => {
                setAdding(false);
                setNewName('');
              }}
            >
              {t('tree.cancel', 'Cancel')}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
