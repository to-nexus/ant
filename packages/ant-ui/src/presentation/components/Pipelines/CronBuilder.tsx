/**
 * CronBuilder — trigger configuration with a server round-trip preview.
 * The FE never parses cron: `previewPipelineFires` both renders the next
 * fires and gates saving (a failed parse disables the save leg upstream via
 * `onValidity`). Presets cover the common shapes; custom exposes the raw
 * 5-field expression.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuroraSelect, AuroraInput, FieldLabel } from '../ConfigEditor/aurora';
import { previewPipelineFires } from '@/infrastructure/http/api/pipelines';

const PRESETS: Array<{ id: string; cron: string }> = [
  { id: 'hourly', cron: '0 * * * *' },
  { id: 'daily', cron: '0 9 * * *' },
  { id: 'weekly', cron: '0 9 * * 1' },
  { id: 'monthly', cron: '0 9 1 * *' },
];

const COMMON_TZS = ['UTC', 'Asia/Seoul', 'Asia/Tokyo', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Berlin'];

export interface CronBuilderProps {
  cron: string;
  tz?: string;
  onChange: (patch: { cron?: string; tz?: string }) => void;
  onValidity: (ok: boolean) => void;
}

export function CronBuilder({ cron, tz, onChange, onValidity }: CronBuilderProps) {
  const { t } = useTranslation('pipelines');
  const [preview, setPreview] = useState<{ ok: boolean; error?: string; fires: string[] } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const presetId = useMemo(() => PRESETS.find((p) => p.cron === cron)?.id ?? 'custom', [cron]);

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzOptions = useMemo(() => {
    const all = new Set([...(browserTz ? [browserTz] : []), ...COMMON_TZS, ...(tz ? [tz] : [])]);
    return [...all].map((z) => ({ value: z, label: z }));
  }, [browserTz, tz]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await previewPipelineFires(cron, tz);
        setPreview(result);
        onValidity(result.ok);
      } catch {
        // Network hiccup: keep the previous verdict rather than blocking saves.
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cron, tz]);

  const fmt = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz || undefined }),
    [tz],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <FieldLabel>{t('trigger.preset', 'Frequency')}</FieldLabel>
        <AuroraSelect
          value={presetId}
          onChange={(v) => {
            const preset = PRESETS.find((p) => p.id === v);
            if (preset) onChange({ cron: preset.cron });
          }}
          options={[
            ...PRESETS.map((p) => ({ value: p.id, label: t(`trigger.presets.${p.id}`, p.id) })),
            { value: 'custom', label: t('trigger.presets.custom', 'Custom (cron)') },
          ]}
        />
      </div>
      <div>
        <FieldLabel action={<span style={{ fontSize: 10, color: 'var(--text-3)' }}>min hour day month weekday</span>}>
          {t('trigger.cron', 'Cron expression')}
        </FieldLabel>
        <AuroraInput mono value={cron} onChange={(v) => onChange({ cron: v })} hasError={preview ? !preview.ok : false} placeholder="0 9 * * 1" />
      </div>
      <div>
        <FieldLabel>{t('trigger.tz', 'Timezone')}</FieldLabel>
        <AuroraSelect value={tz ?? 'UTC'} onChange={(v) => onChange({ tz: v })} options={tzOptions} />
      </div>

      <div
        style={{
          borderRadius: 'var(--r-md)',
          border: `1px solid ${preview && !preview.ok ? 'var(--red-500)' : 'var(--border-1)'}`,
          background: 'var(--bg-surface-2)',
          padding: '10px 12px',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
          {t('trigger.nextFires', 'Next fires')}
        </div>
        {preview === null ? (
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>…</div>
        ) : preview.ok ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {preview.fires.map((iso) => (
              <div key={iso} style={{ fontSize: 11.5, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt.format(new Date(iso))}
                <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>{relativeFromNow(iso, t as any)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: 'var(--red-500)' }}>{preview.error}</div>
        )}
      </div>
    </div>
  );
}

export function relativeFromNow(iso: string, t: (k: string, d: string, o?: any) => string): string {
  const diffMs = Date.parse(iso) - Date.now();
  if (!Number.isFinite(diffMs)) return '';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return t('time.inMinutes', 'in {{n}}m', { n: Math.max(minutes, 1) });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('time.inHours', 'in {{n}}h', { n: hours });
  return t('time.inDays', 'in {{n}}d', { n: Math.round(hours / 24) });
}
