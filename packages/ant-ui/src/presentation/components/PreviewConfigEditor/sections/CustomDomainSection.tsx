import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Plus, RefreshCw, Trash2, Copy, Check, AlertCircle } from 'lucide-react';
import { SectionCard } from '@/presentation/components/ConfigEditor/aurora';
import { StepIndicator } from '@/presentation/components/common/async/primitives/StepIndicator';
import { buildStepStatusArray } from '@/presentation/components/common/async/buildStepStatusArray';
import { useCustomDomainManager } from '../../FeatureSection/hooks/useCustomDomainManager';
import type { DeployStatus } from '@/infrastructure/http/api';
import type { CustomDomainWithDns, CustomDomainStatus, CustomDomainTarget, CustomDomainDnsInstructions } from '@/infrastructure/http/api';

const STATUS_ORDER: CustomDomainStatus[] = ['pending_dns', 'verifying', 'active'];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      style={{
        border: 'none', background: 'transparent', cursor: 'pointer',
        color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', padding: 2,
      }}
      aria-label="Copy"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

interface DnsRecord { label: string; name: string; value: string }

/** Base domain of a wildcard `*.example.com` connection, or null if not wildcard. */
function wildcardBase(dns: CustomDomainDnsInstructions): string | null {
  return dns.connection.kind === 'cname' && dns.connection.name.startsWith('*.')
    ? dns.connection.name.slice(2)
    : null;
}

/**
 * Flatten DNS instructions into a single ordered record list — the SSOT shared
 * by the per-row render and the "copy all" plain-text export so the two never
 * drift.
 *
 * Ordered root-first: TXT → apex A → connection. For a WILDCARD registration we
 * default to the works-everywhere concrete form — a `www.<base>` CNAME instead
 * of `*.<base>` — because many DNS providers (esp. `.co.kr` registrars) don't
 * support wildcard records. The `*.` shortcut is surfaced as a note, not a row.
 */
function dnsRecords(dns: CustomDomainDnsInstructions): DnsRecord[] {
  const rows: DnsRecord[] = [{ label: 'TXT', name: dns.txt.name, value: dns.txt.value }];
  if (dns.apexConnection) {
    for (const ip of dns.apexConnection.values) rows.push({ label: 'A', name: dns.apexConnection.name, value: ip });
  }
  const base = wildcardBase(dns);
  if (base) {
    rows.push({ label: 'CNAME', name: `www.${base}`, value: (dns.connection as { value: string }).value });
  } else if (dns.connection.kind === 'cname') {
    rows.push({ label: 'CNAME', name: dns.connection.name, value: dns.connection.value });
  } else {
    for (const ip of dns.connection.values) rows.push({ label: 'A', name: dns.connection.name, value: ip });
  }
  return rows;
}

/** Newline-separated `TYPE⇥name⇥value` — pasteable into an agent / notepad / sheet. */
function recordsToText(rows: DnsRecord[]): string {
  return rows.map((r) => `${r.label}\t${r.name}\t${r.value}`).join('\n');
}

function DnsRow({ label, name, value }: DnsRecord) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, padding: '3px 0' }}>
      <span style={{ minWidth: 54, color: 'var(--text-3)', fontWeight: 700 }}>{label}</span>
      <code style={{ color: 'var(--text-2)', wordBreak: 'break-all' }}>{name}</code>
      <span style={{ color: 'var(--text-4)' }}>→</span>
      <code style={{ color: 'var(--text-1)', wordBreak: 'break-all', flex: 1 }}>{value}</code>
      <CopyButton value={value} />
    </div>
  );
}

function CopyAllButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700,
        height: 22, padding: '0 7px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-2)',
        background: 'var(--surface-1)', color: 'var(--text-2)', cursor: 'pointer',
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />} {label}
    </button>
  );
}

function statusBadge(status: CustomDomainStatus, t: ReturnType<typeof useTranslation>['t']) {
  const map: Record<CustomDomainStatus, { fg: string; label: string }> = {
    active: { fg: 'oklch(45% 0.16 155)', label: t('preview.domain.status.active', 'Active') },
    verifying: { fg: 'var(--violet-700)', label: t('preview.domain.status.verifying', 'Verifying') },
    pending_dns: { fg: 'var(--text-3)', label: t('preview.domain.status.pending', 'Pending DNS') },
    error: { fg: 'var(--status-error-fg)', label: t('preview.domain.status.error', 'Error') },
  };
  const m = map[status];
  return <span style={{ fontSize: 11, fontWeight: 700, color: m.fg }}>{m.label}</span>;
}

function DomainRow({
  domain,
  onVerify,
  onRemove,
}: {
  domain: CustomDomainWithDns;
  onVerify: (h: string) => void;
  onRemove: (h: string) => void;
}) {
  const { t } = useTranslation('explorer');
  const steps = buildStepStatusArray<CustomDomainStatus>({
    order: STATUS_ORDER,
    currentPhase: domain.status === 'error' ? null : domain.status,
    failedPhase: domain.status === 'error' ? 'verifying' : null,
    labels: {
      pending_dns: t('preview.domain.step.dns', 'DNS'),
      verifying: t('preview.domain.step.verify', 'Verify'),
      active: t('preview.domain.step.active', 'Active'),
      error: t('preview.domain.status.error', 'Error'),
    },
  });

  return (
    <div style={{ border: '1px solid var(--border-1)', borderRadius: 'var(--r-md)', padding: 10, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Globe size={14} style={{ color: 'var(--text-3)' }} />
        <a
          href={`https://${domain.hostname}`}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)', textDecoration: 'none' }}
        >
          {domain.wildcard ? `*.${domain.hostname}` : domain.hostname}
        </a>
        <span style={{ fontSize: 10.5, color: 'var(--text-4)' }}>({domain.target})</span>
        {domain.wildcard && (
          <span
            title={t('preview.domain.wildcardHint', 'Covers the apex and every subdomain')}
            style={{ fontSize: 10, fontWeight: 700, color: 'var(--violet-700)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-sm)', padding: '1px 5px' }}
          >
            {t('preview.domain.wildcardBadge', 'Wildcard')}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {statusBadge(domain.status, t)}
      </div>

      <div style={{ marginTop: 8 }}>
        <StepIndicator steps={steps} orientation="horizontal" />
      </div>

      {(() => {
        const rows = dnsRecords(domain.dns);
        const base = wildcardBase(domain.dns);
        const target = base ? (domain.dns.connection as { value: string }).value : null;
        return (
          <div style={{ marginTop: 8, background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', padding: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', flex: 1 }}>
                {domain.status !== 'active'
                  ? t('preview.domain.dnsHint', 'Add these records at your DNS provider, then verify:')
                  : t('preview.domain.dnsHintActive', 'DNS records for this domain (add any missing ones at your DNS provider):')}
              </div>
              <CopyAllButton text={recordsToText(rows)} label={t('preview.domain.copyAll', 'Copy all')} />
            </div>
            {rows.map((r, i) => (
              <DnsRow key={`${r.label}-${r.name}-${r.value}-${i}`} label={r.label} name={r.name} value={r.value} />
            ))}
            {base && (
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.5 }}>
                {t(
                  'preview.domain.wildcardFallback',
                  'Add one CNAME like www for each subdomain you need (e.g. app → target). If your DNS provider supports wildcard records, a single {{wild}} → {{target}} covers them all.',
                  { wild: `*.${base}`, target },
                )}
              </div>
            )}
          </div>
        );
      })()}

      {domain.error && domain.error !== 'removed' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: 'var(--status-error-fg)' }}>
          <AlertCircle size={12} /> {domain.error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {domain.status !== 'active' && (
          <button
            type="button"
            onClick={() => onVerify(domain.hostname)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, height: 28, padding: '0 10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-2)', background: 'var(--surface-1)', color: 'var(--text-1)', cursor: 'pointer' }}
          >
            <RefreshCw size={12} /> {t('preview.domain.verify', 'Verify')}
          </button>
        )}
        <button
          type="button"
          onClick={() => onRemove(domain.hostname)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, height: 28, padding: '0 10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-2)', background: 'transparent', color: 'var(--status-error-fg)', cursor: 'pointer' }}
        >
          <Trash2 size={12} /> {t('preview.domain.remove', 'Remove')}
        </button>
      </div>
    </div>
  );
}

/**
 * Custom-domain management (deploy-only). Renders only when a deploy exists —
 * a domain has nothing to point at otherwise. Self-contained: drives its own
 * data via `useCustomDomainManager`.
 */
export function CustomDomainSection({
  selectedProject,
  selectedFeature,
  deployStatus,
}: {
  selectedProject: string | undefined;
  selectedFeature: string | undefined;
  deployStatus: DeployStatus | undefined;
}) {
  const { t } = useTranslation('explorer');
  const { domains, enabled, register, verify, remove } = useCustomDomainManager(
    selectedProject, selectedFeature, { primary: true },
  );

  const [hostname, setHostname] = useState('');
  const [target, setTarget] = useState<CustomDomainTarget>('frontend');
  const [slug, setSlug] = useState<string>('');
  const [wildcard, setWildcard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  // Only meaningful once something is deployed.
  const phase = deployStatus?.phase;
  const hasDeploy = phase != null && phase !== 'idle';
  if (!hasDeploy) return null;

  const packages = deployStatus?.packages ?? [];
  const isMulti = packages.length > 1;

  const onAdd = async () => {
    if (!hostname.trim()) return;
    setBusy(true);
    setFormError(undefined);
    const res = await register(hostname.trim(), target, isMulti ? (slug || undefined) : undefined, wildcard);
    setBusy(false);
    if (res.ok) {
      setHostname('');
      setWildcard(false);
    } else {
      setFormError(res.message);
    }
  };

  return (
    <SectionCard
      id="c3v-custom-domain"
      icon={<Globe size={16} strokeWidth={2} />}
      title={t('preview.domain.title', 'Custom Domain')}
      description={t('preview.domain.subtitle', 'Serve this deploy on a domain you own')}
      accent="cool"
    >
      {!enabled ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {t('preview.domain.disabled', 'Custom domains are not available in this environment.')}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="app.example.com"
              style={{ flex: 1, minWidth: 180, height: 34, padding: '0 10px', fontSize: 12.5, borderRadius: 'var(--r-md)', border: '1px solid var(--border-2)', background: 'var(--surface-1)', color: 'var(--text-1)' }}
            />
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as CustomDomainTarget)}
              style={{ height: 34, padding: '0 8px', fontSize: 12.5, borderRadius: 'var(--r-md)', border: '1px solid var(--border-2)', background: 'var(--surface-1)', color: 'var(--text-1)' }}
            >
              <option value="frontend">{t('preview.domain.frontend', 'Frontend')}</option>
              <option value="backend">{t('preview.domain.backend', 'Backend')}</option>
            </select>
            {isMulti && (
              <select
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                style={{ height: 34, padding: '0 8px', fontSize: 12.5, borderRadius: 'var(--r-md)', border: '1px solid var(--border-2)', background: 'var(--surface-1)', color: 'var(--text-1)' }}
              >
                <option value="">{t('preview.domain.selectPackage', 'Select package…')}</option>
                {packages.map((p) => (
                  <option key={p.slug} value={p.slug}>{p.name}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={onAdd}
              disabled={busy || !hostname.trim() || (isMulti && !slug)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 34, padding: '0 12px', fontSize: 12.5, fontWeight: 700, borderRadius: 'var(--r-md)', border: 'none', background: 'var(--gradient-cool)', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy || !hostname.trim() || (isMulti && !slug) ? 0.55 : 1 }}
            >
              <Plus size={13} /> {t('preview.domain.add', 'Add')}
            </button>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11.5, color: 'var(--text-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={wildcard} onChange={(e) => setWildcard(e.target.checked)} />
            {t('preview.domain.wildcard', 'Include all subdomains (wildcard)')}
          </label>
          {formError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: 'var(--status-error-fg)' }}>
              <AlertCircle size={12} /> {formError}
            </div>
          )}

          {domains.map((d) => (
            <DomainRow key={d.hostname} domain={d} onVerify={verify} onRemove={remove} />
          ))}
        </>
      )}
    </SectionCard>
  );
}
