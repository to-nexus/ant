/**
 * PaymentModal — generic (mock) card-form checkout.
 *
 * Owns the card fields, decline/error surface, and Pay button. The card form is
 * the ONLY piece coupled to "raw card data" — swapping in a real PG (e.g.
 * Stripe Elements) replaces this form's internals only. Callers supply an order
 * summary node and an `onPay(paymentMethod)` action (credit top-up OR plan
 * subscribe), so top-up and plan checkout share one form.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { Modal, type ModalAccent } from '@/presentation/components/common/Modal';
import { AuroraInput } from '@/presentation/components/ConfigEditor/aurora/AuroraInput';
import { formatUsd } from '@/shared/utils/tokenUtils';
import { MOCK_SUCCESS_CARD, MOCK_DECLINE_CARD, type PaymentMethodInput, type PurchaseOutcome } from '@ant/shared';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  accent?: ModalAccent;
  /** Order summary block rendered above the card form. */
  summary: React.ReactNode;
  /** Amount the Pay button charges (for the button label). */
  amountUsd: number;
  /** Charge action; resolves to the outcome (never throws). */
  onPay: (paymentMethod: PaymentMethodInput) => Promise<PurchaseOutcome>;
  /** Toast message on success. */
  successMessage: string;
}

/** "1234 5678 9012 3456" grouping for display. */
function groupPan(digits: string): string {
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

/** Parse "MM/YY" → { expMonth, expYear } (2000-based). NaN parts on bad input. */
function parseExpiry(raw: string): { expMonth: number; expYear: number } {
  const [mm, yy] = raw.split('/').map((s) => s.trim());
  return { expMonth: Number(mm), expYear: yy ? 2000 + Number(yy) : NaN };
}

export function PaymentModal({
  isOpen,
  onClose,
  title,
  eyebrow,
  accent = 'violet',
  summary,
  amountUsd,
  onPay,
  successMessage,
}: PaymentModalProps) {
  const { t } = useTranslation('config');
  const { showSuccess } = useAlertModalContext();

  const [pan, setPan] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const panDigits = pan.replace(/\D/g, '').slice(0, 16);
  const cvcDigits = cvc.replace(/\D/g, '').slice(0, 4);
  const canSubmit = panDigits.length >= 15 && /^\d{2}\/\d{2}$/.test(expiry) && cvcDigits.length >= 3;

  const reset = () => {
    setPan('');
    setExpiry('');
    setCvc('');
    setErrorMsg(null);
    setProcessing(false);
  };

  const handleClose = () => {
    if (processing) return;
    reset();
    onClose();
  };

  const handlePay = async () => {
    if (!canSubmit || processing) return;
    setErrorMsg(null);
    setProcessing(true);
    const { expMonth, expYear } = parseExpiry(expiry);
    const outcome = await onPay({ cardNumber: panDigits, expMonth, expYear, cvc: cvcDigits });
    setProcessing(false);
    if (outcome.ok) {
      showSuccess(successMessage);
      reset();
      onClose();
      return;
    }
    setErrorMsg(
      outcome.status === 'declined'
        ? t('account.paymentDeclined', 'Your card was declined. Try a different card.')
        : t('account.paymentError', 'Payment could not be processed. Please try again.'),
    );
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      eyebrow={eyebrow}
      accent={accent}
      size="sm"
      footer={
        <>
          <button
            onClick={handleClose}
            disabled={processing}
            className="px-3 py-1.5 text-xs rounded"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--text-2)' }}
          >
            {t('account.cancel', 'Cancel')}
          </button>
          <button
            onClick={() => void handlePay()}
            disabled={!canSubmit || processing}
            className="px-3 py-1.5 text-xs rounded font-medium"
            style={{
              background: !canSubmit || processing ? 'var(--bg-surface-2)' : 'var(--violet-500)',
              color: !canSubmit || processing ? 'var(--text-3)' : 'white',
              border: '1px solid var(--border-1)',
              cursor: !canSubmit || processing ? 'not-allowed' : 'pointer',
            }}
          >
            {processing
              ? t('account.processing', 'Processing…')
              : t('account.payNow', 'Pay {{amount}}', { amount: formatUsd(amountUsd) })}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {summary}

        {/* Card form */}
        <div className="space-y-2">
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
              {t('account.cardNumber', 'Card number')}
            </div>
            <AuroraInput value={groupPan(panDigits)} onChange={(v) => setPan(v)} placeholder="4242 4242 4242 4242" mono />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
                {t('account.cardExpiry', 'Expiry (MM/YY)')}
              </div>
              <AuroraInput value={expiry} onChange={(v) => setExpiry(v)} placeholder="12/30" mono />
            </div>
            <div className="flex-1">
              <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
                {t('account.cardCvc', 'CVC')}
              </div>
              <AuroraInput value={cvcDigits} onChange={(v) => setCvc(v)} placeholder="123" mono />
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="text-xs" style={{ color: 'var(--status-error-fg)' }}>
            {errorMsg}
          </div>
        )}

        <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          {t('account.testCardHint', 'Test mode — {{ok}} succeeds, {{decline}} is declined.', {
            ok: groupPan(MOCK_SUCCESS_CARD),
            decline: groupPan(MOCK_DECLINE_CARD),
          })}
        </div>
      </div>
    </Modal>
  );
}
