import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditIcon } from './CreditIcon';
import { PricingMatrixModal } from './PricingMatrixModal';

/**
 * GNB credit-slot surface for `serverMode === 'local'`.
 *
 * The cloud navbar shows a credit balance here; local mode has no ledger — the
 * user calls the provider with their own API key. So the same coin glyph stays
 * (position parity with cloud) but the number is replaced by "LLM", and the
 * menu explains where the keys come from plus a link to the model rate card.
 *
 * Mirrors `LocalUserBadge`'s dropdown mechanics (ref + mousedown outside-click)
 * since the two sit side by side in the navbar.
 */
export function LocalLlmBadge() {
  const { t } = useTranslation('nav');
  const [open, setOpen] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <>
      <div className="relative hidden sm:block" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          title={t('billing.llmTooltipTitle', 'Local LLM')}
          className="inline-flex items-center text-xs font-mono font-medium px-2 py-1"
          style={{
            background: 'var(--bg-surface-2)',
            borderRadius: 'var(--r-md)',
            color: 'var(--text-2)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surface-2)'; }}
        >
          <CreditIcon size={13} className="mr-1" />
          {t('billing.llmBadge', 'LLM')}
        </button>

        {open && (
          <div
            className="absolute top-full right-0 mt-2 w-72 py-2 z-50"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-2)',
              borderRadius: 'var(--r-md)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <div className="px-4 pb-2">
              <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-4)' }}>
                {t('billing.llmTooltipTitle', 'Local LLM')}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                {t('billing.llmTooltipBody', 'In local mode every LLM call uses your own API key — Ant charges no credits.')}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                {t('billing.llmEnvHint', 'Set the keys as environment variables in .env (ANTHROPIC_API_KEY, OPENAI_API_KEY, …).')}
              </p>
            </div>
            <div className="my-1" style={{ height: 1, background: 'var(--border-1)' }} />
            <button
              onClick={() => {
                setOpen(false);
                setShowPricing(true);
              }}
              className="w-full px-4 py-1.5 text-left text-xs"
              style={{ color: 'var(--text-2)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {t('billing.viewPricing', 'View pricing →')}
            </button>
          </div>
        )}
      </div>

      <PricingMatrixModal isOpen={showPricing} onClose={() => setShowPricing(false)} />
    </>
  );
}
