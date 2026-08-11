/**
 * Structured `mcp.servers` editor — shared by the agent and job definition
 * cards (both yaml files carry the same block; the job's entry wins on a name
 * collision at load time). It mutates the card's own document through
 * `useDefinitionDocs.setMcpServers`, so the YAML view is the same buffer and
 * the shell's ChangedBar owns saving.
 *
 * `args`, `env`, and `headers` are row-per-entry rather than one delimited
 * field: an arg may legitimately contain spaces or commas, so any split rule
 * would be a guess. Transport picks the field set — http shows `url` + `headers`
 * (its only auth mechanism), stdio shows command/args/env; the connection
 * manager ignores the other side's fields either way.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Trash2 } from 'lucide-react';
import {
  MCP_ENV_VAR_NAME_PATTERN,
  MCP_HEADER_NAME_PATTERN,
  isValidCustomId,
  type McpServerConfig,
} from '@ant/shared';
import { Button } from '@/presentation/components/aurora';
import { AuroraInput, AuroraSelect, FieldLabel } from '@/presentation/components/ConfigEditor/aurora';
import {
  deleteMcpCredential,
  fetchMcpCredentials,
  saveMcpCredential,
} from '@/infrastructure/http/api/accountAgents';

const ICON_BTN =
  'inline-flex items-center justify-center h-6 w-6 shrink-0 rounded text-[color:var(--text-4)] hover:text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition-colors';

/**
 * Layout is container-query driven, not viewport driven — this editor renders
 * inside a settings column whose width is set by the shell, so a media query
 * would react to the wrong box. Every field wrapper carries `min-width: 0`
 * because an `<input>`'s intrinsic min-content width (~20ch) otherwise becomes
 * the row's floor and pushes the card into overflow.
 */
const MCP_LAYOUT_CSS = `
.mcp-server-card { container-type: inline-size; container-name: mcp-server; }
.mcp-head { display: flex; align-items: center; gap: 8px; }
.mcp-head-name { flex: 1; min-width: 0; }
.mcp-head-transport { width: 130px; flex-shrink: 0; }
.mcp-field-row { display: flex; gap: 8px; }
.mcp-field-label {
  width: 68px;
  flex-shrink: 0;
  padding-top: 8px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-4);
}
.mcp-field-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.mcp-kv-row { display: flex; align-items: center; gap: 6px; }
.mcp-kv-key, .mcp-kv-value, .mcp-kv-solo { flex: 1; min-width: 0; }
.mcp-kv-arrow { flex-shrink: 0; color: var(--text-4); font-size: 12px; }

@container mcp-server (max-width: 420px) {
  .mcp-field-row { flex-direction: column; gap: 4px; }
  .mcp-field-label { width: auto; padding-top: 0; }
}
@container mcp-server (max-width: 300px) {
  .mcp-head-name { flex-basis: 100%; }
  .mcp-head { flex-wrap: wrap; }
  .mcp-kv-row { flex-wrap: wrap; }
  .mcp-kv-arrow { display: none; }
  /* key takes its own line; value keeps the remove button beside it */
  .mcp-kv-key { flex-basis: 100%; }
  .mcp-kv-value, .mcp-kv-solo { flex-basis: calc(100% - 30px); }
}
`;

/** Rename a key without losing its position — server order is the file's order. */
function renameKey(
  servers: Record<string, McpServerConfig>,
  from: string,
  to: string,
): Record<string, McpServerConfig> {
  return Object.fromEntries(Object.entries(servers).map(([k, v]) => [k === from ? to : k, v]));
}

function RowLabel({ children }: { children: string }) {
  return <span className="mcp-field-label">{children}</span>;
}

/**
 * key → CREDENTIAL_KEY row list. Shared by stdio `env` and http `headers`: both
 * map a name to a credential key NAME (registered in the encrypted per-user
 * store), so they get the same editor and the same value validation rather
 * than two drifting copies.
 */
function EnvVarNameRows({
  entries,
  disabled,
  keyPlaceholder,
  removeLabel,
  addLabel,
  keyHasError,
  onChange,
}: {
  entries: [string, string][];
  disabled: boolean;
  keyPlaceholder?: string;
  removeLabel: string;
  addLabel: string;
  keyHasError?: (key: string) => boolean;
  onChange: (next: Record<string, string>) => void;
}) {
  const replaceAt = (i: number, pair: [string, string]) =>
    onChange(Object.fromEntries(entries.map((e, j) => (j === i ? pair : e))));

  return (
    <div className="mcp-field-body">
      {entries.map(([key, value], i) => (
        <div key={i} className="mcp-kv-row">
          <div className="mcp-kv-key">
            <AuroraInput
              value={key}
              mono
              disabled={disabled}
              hasError={keyHasError?.(key) ?? false}
              onChange={(v) => replaceAt(i, [v, value])}
              placeholder={keyPlaceholder}
            />
          </div>
          <span className="mcp-kv-arrow">→</span>
          <div className="mcp-kv-value">
            <AuroraInput
              value={value}
              mono
              disabled={disabled}
              hasError={!MCP_ENV_VAR_NAME_PATTERN.test(value)}
              onChange={(v) => replaceAt(i, [key, v])}
              placeholder="CREDENTIAL_KEY"
            />
          </div>
          {!disabled && (
            <button
              type="button"
              className={ICON_BTN}
              aria-label={removeLabel}
              onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}
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
            onClick={() => onChange({ ...Object.fromEntries(entries), '': '' })}
          >
            <Plus className="w-3 h-3" /> {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Registration surface for the credential keys the servers above reference
 * (A16). Values are write-only: saving PUTs into the encrypted per-user store
 * and the input clears — the store never echoes a secret back, only
 * key + updatedAt. Deliberately NOT gated on the definition's `disabled`
 * (readonly scope): credentials are account-scoped data, not a definition
 * edit, so a viewer of a readonly agent can still register their own values.
 */
function McpCredentialsPanel({ referencedKeys }: { referencedKeys: string[] }) {
  const { t } = useTranslation('agents');
  const [registeredAt, setRegisteredAt] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMcpCredentials()
      .then((r) => {
        if (cancelled) return;
        setRegisteredAt(Object.fromEntries(r.credentials.map((c) => [c.key, c.updatedAt])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (referencedKeys.length === 0) return null;

  const save = async (key: string) => {
    const value = (drafts[key] ?? '').trim();
    if (!value || busyKey) return;
    setBusyKey(key);
    try {
      await saveMcpCredential(key, value);
      setRegisteredAt((prev) => ({ ...prev, [key]: new Date().toISOString() }));
      setDrafts((prev) => ({ ...prev, [key]: '' }));
      setFlashKey(key);
      setTimeout(() => setFlashKey((k) => (k === key ? null : k)), 2000);
    } catch (e) {
      console.error('[McpCredentials] Save failed:', e);
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (key: string) => {
    if (busyKey) return;
    setBusyKey(key);
    try {
      await deleteMcpCredential(key);
      setRegisteredAt((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)));
    } catch (e) {
      console.error('[McpCredentials] Delete failed:', e);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div style={{ marginTop: 14 }}>
      <FieldLabel optional>{t('agentDef.mcpCredentials', 'MCP credentials')}</FieldLabel>
      <p style={{ margin: '0 0 10px', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-3)' }}>
        {t(
          'agentDef.mcpCredentialsHint',
          'Keys referenced by the servers above. Values are stored encrypted per user and never shown again.',
        )}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {referencedKeys.map((key) => {
          const isRegistered = key in registeredAt;
          return (
            <div key={key} className="mcp-kv-row">
              <div
                className="mcp-kv-key"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11.5,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-2)',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key}</span>
                <span
                  style={{
                    flexShrink: 0,
                    padding: '1px 6px',
                    borderRadius: 999,
                    fontSize: 10,
                    fontFamily: 'inherit',
                    color: isRegistered ? 'var(--status-done-fg)' : 'var(--text-4)',
                    border: `1px solid ${isRegistered ? 'var(--status-done-fg)' : 'var(--border-2)'}`,
                  }}
                >
                  {isRegistered
                    ? t('agentDef.mcpCredRegistered', 'registered')
                    : t('agentDef.mcpCredUnregistered', 'not registered')}
                </span>
              </div>
              <span className="mcp-kv-arrow">→</span>
              <div className="mcp-kv-value">
                <AuroraInput
                  value={drafts[key] ?? ''}
                  type="password"
                  mono
                  autoComplete="off"
                  disabled={busyKey === key}
                  onChange={(v) => setDrafts((prev) => ({ ...prev, [key]: v }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void save(key);
                  }}
                  placeholder={t('agentDef.mcpCredValuePlaceholder', 'secret value (e.g. Bearer …)')}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={!(drafts[key] ?? '').trim() || busyKey === key}
                onClick={() => void save(key)}
              >
                {flashKey === key ? (
                  <>
                    <Check className="w-3 h-3" /> {t('agentDef.mcpCredSaved', 'Saved')}
                  </>
                ) : (
                  t('agentDef.mcpCredSave', 'Save')
                )}
              </Button>
              {isRegistered && (
                <button
                  type="button"
                  className={ICON_BTN}
                  title={t('agentDef.mcpCredDelete', 'Remove credential')}
                  aria-label={t('agentDef.mcpCredDelete', 'Remove credential')}
                  onClick={() => void remove(key)}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
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

  // Distinct credential keys the declared servers reference (headers + env),
  // pattern-valid only — half-typed values don't spawn registration rows.
  const referencedCredentialKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const cfg of Object.values(servers)) {
      for (const v of [...Object.values(cfg.headers ?? {}), ...Object.values(cfg.env ?? {})]) {
        if (typeof v === 'string' && MCP_ENV_VAR_NAME_PATTERN.test(v)) keys.add(v);
      }
    }
    return [...keys].sort();
  }, [servers]);

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
      <style>{MCP_LAYOUT_CSS}</style>
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
              className="mcp-server-card"
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
              <div className="mcp-head">
                <div className="mcp-head-name">
                  <AuroraInput
                    value={name}
                    mono
                    disabled={disabled}
                    hasError={!isValidCustomId(name)}
                    onChange={(v) => onChange(renameKey(servers, name, v))}
                  />
                </div>
                <div className="mcp-head-transport">
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
                <>
                  <div className="mcp-field-row">
                    <RowLabel>url</RowLabel>
                    <div className="mcp-field-body">
                      <AuroraInput
                        value={cfg.url ?? ''}
                        mono
                        disabled={disabled}
                        onChange={(v) => patch(name, { url: v })}
                        placeholder="https://…"
                      />
                    </div>
                  </div>

                  <div className="mcp-field-row">
                    <RowLabel>headers</RowLabel>
                    <EnvVarNameRows
                      entries={Object.entries(cfg.headers ?? {})}
                      disabled={disabled}
                      keyPlaceholder="Authorization"
                      keyHasError={(key) => key.length > 0 && !MCP_HEADER_NAME_PATTERN.test(key)}
                      removeLabel={t('agentDef.mcpRemoveHeader', 'Remove header')}
                      addLabel={t('agentDef.mcpAddHeader', 'Add header')}
                      onChange={(headers) => patch(name, { headers })}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="mcp-field-row">
                    <RowLabel>command</RowLabel>
                    <div className="mcp-field-body">
                      <AuroraInput
                        value={cfg.command ?? ''}
                        mono
                        disabled={disabled}
                        onChange={(v) => patch(name, { command: v })}
                        placeholder="npx"
                      />
                    </div>
                  </div>

                  <div className="mcp-field-row">
                    <RowLabel>args</RowLabel>
                    <div className="mcp-field-body">
                      {args.map((arg, i) => (
                        <div key={i} className="mcp-kv-row">
                          <div className="mcp-kv-solo">
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

                  <div className="mcp-field-row">
                    <RowLabel>env</RowLabel>
                    <EnvVarNameRows
                      entries={env}
                      disabled={disabled}
                      removeLabel={t('agentDef.mcpRemoveEnv', 'Remove variable')}
                      addLabel={t('agentDef.mcpAddEnv', 'Add variable')}
                      onChange={(next) => patch(name, { env: next })}
                    />
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
            style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 420, flexWrap: 'wrap' }}
          >
            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
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

      <div className="mcp-server-card">
        <McpCredentialsPanel referencedKeys={referencedCredentialKeys} />
      </div>
    </div>
  );
}
