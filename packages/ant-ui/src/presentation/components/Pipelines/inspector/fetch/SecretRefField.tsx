/**
 * A header value that is either a literal or a `${secret:KEY}` reference —
 * and, for a reference, the place the value gets REGISTERED. An inline fetch
 * connection belongs to no agent, so the agent settings credential panel is
 * not where its author is; the key's registration state and the save box sit
 * right under the header that needs it. The store is the same account-scoped
 * one (`useMcpCredentialRegistry`), so a key registered here is visible in
 * agent settings too.
 */

import { useTranslation } from 'react-i18next';
import { KeyRound, Type } from 'lucide-react';
import { MCP_ENV_VAR_NAME_PATTERN, formatSecretRef, parseSecretRef } from '@ant/shared';
import type { McpCredentialRegistry } from '@/application/hooks/ui/useMcpCredentialRegistry';
import { AuroraInput, FieldHint } from '../../../ConfigEditor/aurora';
import { CredentialValueEditor } from '../../../shared/credentials/CredentialValueEditor';
import { ToggleChip } from '../chips';

export interface SecretRefFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Suggested key when the author flips a literal to a reference. */
  suggestedKey: string;
  registry: McpCredentialRegistry;
  disabled?: boolean;
}

export function SecretRefField({ value, onChange, suggestedKey, registry, disabled }: SecretRefFieldProps) {
  const { t } = useTranslation('pipelines');
  const key = parseSecretRef(value);
  const isSecret = key !== null || value.startsWith('${secret:');
  const keyText = key ?? value.replace(/^\$\{secret:/, '').replace(/\}$/, '');
  const keyValid = key !== null;
  const registered = keyValid && key in registry.registeredAt;

  return (
    <div data-secret-ref={isSecret ? keyText : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          <ToggleChip active={!isSecret} disabled={disabled} title={t('trigger.fetch.secretModeLiteral', 'Literal value')} onClick={() => onChange(isSecret ? '' : value)}>
            <Type size={10} />
          </ToggleChip>
          <ToggleChip active={isSecret} disabled={disabled} title={t('trigger.fetch.secretModeRef', 'Credential ${secret:KEY}')} onClick={() => onChange(isSecret ? value : formatSecretRef(suggestedKey))}>
            <KeyRound size={10} />
          </ToggleChip>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isSecret ? (
            <AuroraInput
              mono
              value={keyText}
              disabled={disabled}
              hasError={keyText.length > 0 && !MCP_ENV_VAR_NAME_PATTERN.test(keyText)}
              placeholder={t('trigger.fetch.secretKeyPlaceholder', 'KEY_NAME')}
              prefix={<span style={{ fontSize: 10.5, color: 'var(--text-4)' }}>secret:</span>}
              onChange={(v) => onChange(`\${secret:${v.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}}`)}
            />
          ) : (
            <AuroraInput mono value={value} disabled={disabled} placeholder={t('trigger.fetch.headerValue', 'Value')} onChange={onChange} />
          )}
        </div>
      </div>
      {isSecret && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 2 }}>
          {!keyValid ? (
            <FieldHint tone="warn">{t('trigger.fetch.secretKeyInvalid', 'Key names are upper-case letters, digits and underscores.')}</FieldHint>
          ) : (
            <>
              <span
                data-cred-status={registered ? 'registered' : 'unregistered'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: registered ? 'var(--status-done-fg)' : 'var(--amber-500)' }}
              >
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: 'currentColor' }} />
                {registered ? t('trigger.fetch.secretRegistered', 'Registered in your credentials') : t('trigger.fetch.secretUnregistered', 'Not registered yet — save the value below')}
              </span>
              <CredentialValueEditor
                credentialKey={key}
                registry={registry}
                compact
                labels={{
                  placeholder: t('trigger.fetch.secretValuePlaceholder', 'secret value (e.g. Bearer …)'),
                  save: t('trigger.fetch.secretSave', 'Register'),
                  cancel: t('trigger.fetch.secretCancel', 'Cancel'),
                  edit: t('trigger.fetch.secretReplace', 'Replace'),
                  saved: t('trigger.fetch.secretSaved', 'Saved'),
                  updatedAt: (when) => t('trigger.fetch.secretUpdatedAt', 'updated {{when}}', { when }),
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
