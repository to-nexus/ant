/**
 * The value half of one credential row — masked with an Edit flip once
 * registered, a password input with Save before. Shared by the agent
 * settings MCP credentials panel and the pipeline fetch inspector: both write
 * the same account-scoped store through `useMcpCredentialRegistry`, so the
 * registration gesture must look and behave the same in both places. Labels
 * are passed in — the two screens live in different i18n namespaces.
 */

import { Check, Pencil } from 'lucide-react';
import type { McpCredentialRegistry } from '@/application/hooks/ui/useMcpCredentialRegistry';
import { Button } from '../../aurora';
import { AuroraInput } from '../../ConfigEditor/aurora';

export interface CredentialValueLabels {
  placeholder: string;
  save: string;
  cancel: string;
  edit: string;
  saved: string;
  updatedAt: (when: string) => string;
}

export function CredentialValueEditor({ credentialKey, registry, labels, compact = false }: { credentialKey: string; registry: McpCredentialRegistry; labels: CredentialValueLabels; compact?: boolean }) {
  const { drafts, busyKey, flashKey, editingKeys, registeredAt } = registry;
  const registered = credentialKey in registeredAt;
  const editing = !registered || editingKeys.has(credentialKey);
  const draft = drafts[credentialKey] ?? '';
  const size = compact ? 'xs' : 'sm';

  if (editing) {
    return (
      <div data-cred-editor={credentialKey} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <AuroraInput
            value={draft}
            type="password"
            mono
            autoComplete="off"
            disabled={busyKey === credentialKey}
            onChange={(v) => registry.setDraft(credentialKey, v)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void registry.save(credentialKey);
            }}
            placeholder={labels.placeholder}
          />
        </div>
        <Button size={size} variant="ghost" disabled={!draft.trim() || busyKey === credentialKey} onClick={() => void registry.save(credentialKey)}>
          {labels.save}
        </Button>
        {registered && (
          <Button size={size} variant="ghost" onClick={() => registry.cancelEdit(credentialKey)}>
            {labels.cancel}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div data-cred-editor={credentialKey} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
      {flashKey === credentialKey ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--status-done-fg)' }}>
          <Check size={12} /> {labels.saved}
        </span>
      ) : (
        <span style={{ color: 'var(--text-3)', letterSpacing: 2 }}>••••••••</span>
      )}
      <span style={{ fontSize: 10.5, color: 'var(--text-4)', fontFamily: 'var(--font-sans)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {labels.updatedAt(new Date(registeredAt[credentialKey]).toLocaleDateString())}
      </span>
      <Button size={size} variant="ghost" onClick={() => registry.beginEdit(credentialKey)}>
        <Pencil className="w-3 h-3" /> {labels.edit}
      </Button>
    </div>
  );
}
