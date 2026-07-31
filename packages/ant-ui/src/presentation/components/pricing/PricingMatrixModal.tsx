/**
 * PricingMatrixModal — per-model unit-price matrix ("가격정보").
 *
 * Read-only reference: the USD price per 1M tokens for every billed model,
 * grouped by provider, fetched from `GET /models/pricing`. Those rows are the
 * SAME `MODEL_RATE_CARD` SSOT the ledger charges with, so the numbers here equal
 * what a job is billed (at markup 1.0 — LLM cost is pure pass-through).
 *
 * OSS-resident: the rate card (`@ant/shared`), the endpoint, and the fetch
 * client are all OSS, so both surfaces read it — the cloud billing center and
 * the local-mode LLM badge. Only the footer note differs by server mode, since
 * credits / platform fee are cloud-only vocabulary.
 *
 * Credits are intentionally NOT shown per-row: the USD↔credit rate is fixed
 * (1 credit = $1), so it is stated once in the footer instead.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/presentation/components/common/Modal';
import { formatUsd } from '@/shared/utils/tokenUtils';
import { fetchModelPricing, type ModelPricingResponse } from '@/infrastructure/http/api/llm';
import { useStore } from '@/domain/store';
import { selectCanViewCredits } from '@/domain/store/selectors/auth';
import { USD_PER_CREDIT, type ModelPricingEntry } from '@ant/shared';

interface PricingMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  glm: 'Z.ai (GLM)',
};

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; entries: ModelPricingEntry[] };

/** Group rows by provider, preserving the registry order the endpoint returned. */
function groupByProvider(entries: ModelPricingEntry[]): [string, ModelPricingEntry[]][] {
  const order: string[] = [];
  const map = new Map<string, ModelPricingEntry[]>();
  for (const e of entries) {
    if (!map.has(e.provider)) {
      map.set(e.provider, []);
      order.push(e.provider);
    }
    map.get(e.provider)!.push(e);
  }
  return order.map((p) => [p, map.get(p)!]);
}

export function PricingMatrixModal({ isOpen, onClose }: PricingMatrixModalProps) {
  const { t } = useTranslation('config');
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const canViewCredits = useStore(selectCanViewCredits);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetchModelPricing()
      .then((res: ModelPricingResponse) => {
        if (!cancelled) setState({ status: 'ready', entries: res.entries });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const th = 'text-right px-3 py-1.5 font-medium whitespace-nowrap';
  const td = 'text-right px-3 py-1.5 font-mono tabular-nums whitespace-nowrap';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('billing.pricingTitle', 'Model pricing')}
      eyebrow={t('billing.pricingEyebrow', 'Reference')}
      size="lg"
      accent="aurora"
      scrollable
      footer={
        <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {canViewCredits
            ? t('billing.pricingRateNote', {
                defaultValue:
                  '1 credit = ${{usd}} USD. LLM API cost is billed at provider list price with no margin (pass-through); a separate per-run platform fee applies.',
                usd: USD_PER_CREDIT,
              })
            : t('billing.pricingRateNoteLocal', {
                defaultValue:
                  'Provider public list price. In local mode these calls are billed directly to you by the provider using your own API key — Ant charges nothing.',
              })}
        </div>
      }
    >
      {state.status === 'loading' && (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--text-3)' }}>
          {t('common.loading', 'Loading…')}
        </div>
      )}

      {state.status === 'error' && (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--status-error-fg, var(--text-2))' }}>
          {t('billing.pricingError', 'Could not load pricing. Please try again.')}
        </div>
      )}

      {state.status === 'ready' && (
        <div className="space-y-4">
          <div className="text-xs" style={{ color: 'var(--text-3)' }}>
            {t('billing.pricingSubtitle', 'USD per 1M tokens (MTok). These are the exact rates used to bill each model.')}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border-1)' }}>
                  <th className="text-left px-3 py-1.5 font-medium">{t('billing.pricingModel', 'Model')}</th>
                  <th className={th}>{t('billing.pricingInput', 'Input')}</th>
                  <th className={th}>{t('billing.pricingOutput', 'Output')}</th>
                  <th className={th}>{t('billing.pricingCacheWrite', 'Cache write')}</th>
                  <th className={th}>{t('billing.pricingCacheRead', 'Cache read')}</th>
                </tr>
              </thead>
              <tbody>
                {groupByProvider(state.entries).map(([provider, rows]) => (
                  <ProviderGroup key={provider} provider={provider} rows={rows} td={td} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ProviderGroup({
  provider,
  rows,
  td,
}: {
  provider: string;
  rows: ModelPricingEntry[];
  td: string;
}) {
  const source = rows[0]?.source;
  return (
    <>
      <tr>
        <td colSpan={5} className="px-3 pt-4 pb-1">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
            {PROVIDER_LABEL[provider] ?? provider}
          </span>
          {source && (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 text-[11px] underline"
              style={{ color: 'var(--accent)' }}
            >
              list ↗
            </a>
          )}
        </td>
      </tr>
      {rows.map((e) => (
        <tr key={e.modelId} style={{ borderBottom: '1px solid var(--border-1)' }}>
          <td className="text-left px-3 py-1.5" style={{ color: 'var(--text-1)' }}>{e.displayName}</td>
          <td className={td} style={{ color: 'var(--text-1)' }}>{formatUsd(e.rate.input)}</td>
          <td className={td} style={{ color: 'var(--text-1)' }}>{formatUsd(e.rate.output)}</td>
          <td className={td} style={{ color: 'var(--text-3)' }}>{formatUsd(e.rate.cacheWrite5m)}</td>
          <td className={td} style={{ color: 'var(--text-3)' }}>{formatUsd(e.rate.cacheRead)}</td>
        </tr>
      ))}
    </>
  );
}
