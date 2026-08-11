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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Lock, LockOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  MCP_ENV_VAR_NAME_PATTERN,
  MCP_HEADER_NAME_PATTERN,
  formatSecretRef,
  isValidCustomId,
  parseSecretRef,
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
/* Mode badge lives in the value input's suffix slot, so the row's two
   meanings (literal vs credential key) are readable without hovering. */
.mcp-kv-mode {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 10px;
  font-family: var(--font-mono);
  letter-spacing: 0.02em;
  color: inherit;
}
.mcp-kv-mode:disabled { cursor: default; }

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
 * Loose wrapper detection for UI mode derivation ONLY: any `${secret:…}` shell
 * counts as credential mode so a half-typed key doesn't flip the row back to
 * plain text mid-edit. Validity (error highlight, save gate) stays on the
 * strict shared patterns.
 */
const SECRET_WRAP = /^\$\{secret:(.*)\}$/s;

/** UI mode + editable text of a serialized env/header value. */
function splitValueMode(value: string): { mode: 'secret' | 'plain'; text: string } {
  const m = SECRET_WRAP.exec(value);
  return m ? { mode: 'secret', text: m[1] } : { mode: 'plain', text: value };
}

/** Mirror of `validateMcpServers`' per-value rule, for the error highlight. */
function valueHasError(value: string): boolean {
  const { mode, text } = splitValueMode(value);
  if (mode === 'secret') return !MCP_ENV_VAR_NAME_PATTERN.test(text);
  return text.trim() === '';
}

/**
 * key → value row list. Shared by stdio `env` and http `headers`: both map a
 * name to either plain text (kept verbatim in the yaml) or a `${secret:KEY}`
 * credential reference — the author declares which per row via the lock
 * toggle, so both slots get the same editor and the same validation rather
 * than two drifting copies.
 */
function EnvVarNameRows({
  entries,
  disabled,
  keyPlaceholder,
  removeLabel,
  addLabel,
  keyHasError,
  credentialStatusOf,
  onCredentialJump,
  onChange,
}: {
  entries: [string, string][];
  disabled: boolean;
  keyPlaceholder?: string;
  removeLabel: string;
  addLabel: string;
  keyHasError?: (key: string) => boolean;
  /** Registered-in-store lookup for a credential key (undefined = no registry wired). */
  credentialStatusOf?: (credKey: string) => boolean;
  /** Scroll/focus the credentials panel row for this key. */
  onCredentialJump?: (credKey: string) => void;
  onChange: (next: Record<string, string>) => void;
}) {
  const { t } = useTranslation('agents');
  const replaceAt = (i: number, pair: [string, string]) =>
    onChange(Object.fromEntries(entries.map((e, j) => (j === i ? pair : e))));

  return (
    <div className="mcp-field-body">
      {entries.map(([key, value], i) => {
        const { mode, text } = splitValueMode(value);
        const isSecret = mode === 'secret';
        const credKey = parseSecretRef(value);
        const registered = credKey !== null && (credentialStatusOf?.(credKey) ?? false);
        return (
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
                value={text}
                mono
                disabled={disabled}
                hasError={valueHasError(value)}
                onChange={(v) => replaceAt(i, [key, isSecret ? formatSecretRef(v) : v])}
                placeholder={isSecret ? 'CREDENTIAL_KEY' : t('agentDef.mcpPlainValuePlaceholder', 'value')}
                suffix={
                  <button
                    type="button"
                    className="mcp-kv-mode"
                    disabled={disabled}
                    title={
                      isSecret
                        ? t('agentDef.mcpValueModeSecret', 'Credential (encrypted) — click for plain text')
                        : t('agentDef.mcpValueModePlain', 'Plain text — click for credential')
                    }
                    aria-label={
                      isSecret
                        ? t('agentDef.mcpValueModeSecret', 'Credential (encrypted) — click for plain text')
                        : t('agentDef.mcpValueModePlain', 'Plain text — click for credential')
                    }
                    aria-pressed={isSecret}
                    style={isSecret ? { color: 'var(--select-fg)' } : undefined}
                    onClick={() => replaceAt(i, [key, isSecret ? text : formatSecretRef(text)])}
                  >
                    {isSecret ? <Lock size={11} /> : <LockOpen size={11} />}
                    <span>
                      {isSecret
                        ? t('agentDef.mcpValueModeSecretBadge', 'encrypted')
                        : t('agentDef.mcpValueModePlainBadge', 'plain')}
                    </span>
                  </button>
                }
              />
            </div>
            {isSecret && credKey !== null && onCredentialJump && (
              <button
                type="button"
                className={ICON_BTN}
                title={t('agentDef.mcpCredJump', 'Show in MCP credentials')}
                aria-label={t('agentDef.mcpCredJump', 'Show in MCP credentials')}
                onClick={() => onCredentialJump(credKey)}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: registered ? 'var(--status-done-fg)' : 'transparent',
                    border: registered ? 'none' : '1.5px solid var(--border-2)',
                  }}
                />
              </button>
            )}
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
        );
      })}
      {!disabled && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...Object.fromEntries(entries), '': formatSecretRef('') })}
          >
            <Plus className="w-3 h-3" /> {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

interface McpCredentialRegistry {
  /** key → updatedAt ISO string for every key registered in the store. */
  registeredAt: Record<string, string>;
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  busyKey: string | null;
  flashKey: string | null;
  /** Registered keys whose masked row was flipped open for replacement. */
  editingKeys: ReadonlySet<string>;
  beginEdit: (key: string) => void;
  cancelEdit: (key: string) => void;
  save: (key: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

/**
 * Account-scoped credential registry state (A16), hoisted out of the panel so
 * the binding rows above can decorate themselves with registration status.
 * Values are write-only: saving PUTs into the encrypted per-user store — the
 * store never echoes a secret back, only key + updatedAt.
 */
function useMcpCredentialRegistry(): McpCredentialRegistry {
  const [registeredAt, setRegisteredAt] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [editingKeys, setEditingKeys] = useState<ReadonlySet<string>>(new Set());

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

  const setDraft = useCallback(
    (key: string, value: string) => setDrafts((prev) => ({ ...prev, [key]: value })),
    [],
  );
  const beginEdit = useCallback(
    (key: string) => setEditingKeys((prev) => new Set(prev).add(key)),
    [],
  );
  const cancelEdit = useCallback((key: string) => {
    setEditingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setDrafts((prev) => ({ ...prev, [key]: '' }));
  }, []);

  const save = useCallback(
    async (key: string) => {
      const value = (drafts[key] ?? '').trim();
      if (!value || busyKey) return;
      setBusyKey(key);
      try {
        await saveMcpCredential(key, value);
        setRegisteredAt((prev) => ({ ...prev, [key]: new Date().toISOString() }));
        setDrafts((prev) => ({ ...prev, [key]: '' }));
        setEditingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setFlashKey(key);
        setTimeout(() => setFlashKey((k) => (k === key ? null : k)), 2000);
      } catch (e) {
        console.error('[McpCredentials] Save failed:', e);
      } finally {
        setBusyKey(null);
      }
    },
    [drafts, busyKey],
  );

  const remove = useCallback(
    async (key: string) => {
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
    },
    [busyKey],
  );

  return { registeredAt, drafts, setDraft, busyKey, flashKey, editingKeys, beginEdit, cancelEdit, save, remove };
}

export interface CredentialPanelRow {
  key: string;
  /** Referenced by a `${secret:…}` value of a server in THIS editor. */
  referenced: boolean;
  registered: boolean;
}

/**
 * Panel rows = union(referenced keys, registered keys). Registered-but-
 * unreferenced keys stay visible (and deletable) instead of becoming
 * invisible orphans the moment the last binding is removed.
 */
export function credentialPanelRows(
  referencedKeys: string[],
  registeredAt: Record<string, string>,
): CredentialPanelRow[] {
  const referenced = new Set(referencedKeys);
  const keys = new Set([...referencedKeys, ...Object.keys(registeredAt)]);
  return [...keys]
    .sort()
    .map((key) => ({ key, referenced: referenced.has(key), registered: key in registeredAt }));
}

/**
 * Registration surface for credential keys (A16). A registered key renders
 * masked (`••••••••` + updatedAt) with an explicit Edit flip — the raw input
 * only shows for unregistered keys or during a replacement. Deliberately NOT
 * gated on the definition's `disabled` (readonly scope): credentials are
 * account-scoped data, not a definition edit, so a viewer of a readonly agent
 * can still register their own values.
 */
function McpCredentialsPanel({
  rows,
  registry,
  highlightKey,
}: {
  rows: CredentialPanelRow[];
  registry: McpCredentialRegistry;
  highlightKey: string | null;
}) {
  const { t } = useTranslation('agents');
  if (rows.length === 0) return null;

  const { drafts, busyKey, flashKey, editingKeys } = registry;

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
        {rows.map(({ key, referenced, registered }) => {
          const isEditing = !registered || editingKeys.has(key);
          return (
            <div
              key={key}
              className="mcp-kv-row"
              data-cred-key={key}
              style={
                highlightKey === key
                  ? {
                      boxShadow: '0 0 0 2px var(--violet-300)',
                      borderRadius: 'var(--r-md)',
                      transition: 'box-shadow 150ms ease',
                    }
                  : undefined
              }
            >
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
                    color: registered ? 'var(--status-done-fg)' : 'var(--text-4)',
                    border: `1px solid ${registered ? 'var(--status-done-fg)' : 'var(--border-2)'}`,
                  }}
                >
                  {registered
                    ? t('agentDef.mcpCredRegistered', 'registered')
                    : t('agentDef.mcpCredUnregistered', 'not registered')}
                </span>
                {!referenced && (
                  <span
                    title={t(
                      'agentDef.mcpCredUnreferencedHint',
                      'Not referenced by any server in this definition. You can still remove it.',
                    )}
                    style={{
                      flexShrink: 0,
                      padding: '1px 6px',
                      borderRadius: 999,
                      fontSize: 10,
                      fontFamily: 'inherit',
                      color: 'var(--text-4)',
                      border: '1px dashed var(--border-2)',
                    }}
                  >
                    {t('agentDef.mcpCredUnreferenced', 'unreferenced')}
                  </span>
                )}
              </div>
              <span className="mcp-kv-arrow">→</span>
              {isEditing ? (
                <>
                  <div className="mcp-kv-value">
                    <AuroraInput
                      value={drafts[key] ?? ''}
                      type="password"
                      mono
                      autoComplete="off"
                      disabled={busyKey === key}
                      onChange={(v) => registry.setDraft(key, v)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void registry.save(key);
                      }}
                      placeholder={t('agentDef.mcpCredValuePlaceholder', 'secret value (e.g. Bearer …)')}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!(drafts[key] ?? '').trim() || busyKey === key}
                    onClick={() => void registry.save(key)}
                  >
                    {t('agentDef.mcpCredSave', 'Save')}
                  </Button>
                  {registered && (
                    <Button size="sm" variant="ghost" onClick={() => registry.cancelEdit(key)}>
                      {t('tree.cancel', 'Cancel')}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <div
                    className="mcp-kv-value"
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11.5,
                    }}
                  >
                    {flashKey === key ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          color: 'var(--status-done-fg)',
                        }}
                      >
                        <Check size={12} /> {t('agentDef.mcpCredSaved', 'Saved')}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-3)', letterSpacing: 2 }}>••••••••</span>
                    )}
                    <span style={{ fontSize: 10.5, color: 'var(--text-4)', fontFamily: 'var(--font-sans)' }}>
                      {t('agentDef.mcpCredUpdatedAt', 'updated {{when}}', {
                        when: new Date(registry.registeredAt[key]).toLocaleDateString(),
                      })}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => registry.beginEdit(key)}>
                    <Pencil className="w-3 h-3" /> {t('agentDef.mcpCredEdit', 'Edit')}
                  </Button>
                </>
              )}
              {registered && (
                <button
                  type="button"
                  className={ICON_BTN}
                  title={t('agentDef.mcpCredDelete', 'Remove credential')}
                  aria-label={t('agentDef.mcpCredDelete', 'Remove credential')}
                  onClick={() => void registry.remove(key)}
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
  const registry = useMcpCredentialRegistry();
  const rootRef = useRef<HTMLDivElement>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  const names = Object.keys(servers);
  const newNameValid = isValidCustomId(newName) && !names.includes(newName);

  // Distinct credential keys the declared servers reference via valid
  // `${secret:KEY}` values — half-typed references don't spawn panel rows.
  const referencedCredentialKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const cfg of Object.values(servers)) {
      for (const v of [...Object.values(cfg.headers ?? {}), ...Object.values(cfg.env ?? {})]) {
        const key = parseSecretRef(v);
        if (key !== null) keys.add(key);
      }
    }
    return [...keys].sort();
  }, [servers]);

  const panelRows = useMemo(
    () => credentialPanelRows(referencedCredentialKeys, registry.registeredAt),
    [referencedCredentialKeys, registry.registeredAt],
  );

  const credentialStatusOf = useCallback(
    (key: string) => key in registry.registeredAt,
    [registry.registeredAt],
  );

  // Scoped to this editor's root — the agent and job cards can both mount an
  // McpServersEditor on the same page, each with its own panel.
  const jumpToCredential = useCallback((key: string) => {
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-cred-key="${key}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.querySelector<HTMLInputElement>('input[type="password"]')?.focus({ preventScroll: true });
    setHighlightKey(key);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightKey(null), 1600);
  }, []);

  const patch = (name: string, next: Partial<McpServerConfig>) =>
    onChange({ ...servers, [name]: { ...servers[name], ...next } });

  const submitAdd = () => {
    if (!newNameValid) return;
    onChange({ ...servers, [newName]: { transport: 'stdio', command: '' } });
    setAdding(false);
    setNewName('');
  };

  return (
    <div ref={rootRef}>
      <style>{MCP_LAYOUT_CSS}</style>
      <FieldLabel optional>{t('agentDef.mcpServers', 'MCP servers')}</FieldLabel>
      <p style={{ margin: '0 0 10px', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-3)' }}>
        {t('agentDef.mcpHint', 'env and header values are plain text, or a credential reference (lock toggle) stored encrypted per user — secrets never live in the definition file.')}
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
                      credentialStatusOf={credentialStatusOf}
                      onCredentialJump={jumpToCredential}
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
                      credentialStatusOf={credentialStatusOf}
                      onCredentialJump={jumpToCredential}
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
        <McpCredentialsPanel rows={panelRows} registry={registry} highlightKey={highlightKey} />
      </div>
    </div>
  );
}
