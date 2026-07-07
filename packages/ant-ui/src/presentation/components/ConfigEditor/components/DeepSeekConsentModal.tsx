import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../common/Modal';
import { Button } from '../../aurora';

interface DeepSeekConsentModalProps {
  isOpen: boolean;
  /** Confirm the DeepSeek selection. `dontShowAgain` reflects the checkbox so the
   * caller can persist the "don't show again" acknowledgement. */
  onConfirm: (dontShowAgain: boolean) => void;
  /** Cancel — the selection is not committed (previous model kept). */
  onCancel: () => void;
}

/**
 * Informed-consent gate shown when a DeepSeek model is selected. DeepSeek is a
 * third-party, China-hosted API with materially different data-handling terms;
 * the user must acknowledge before the selection is committed. Risk bullets and
 * all copy live in the `config` i18n namespace (deepseekConsent.*).
 */
export function DeepSeekConsentModal({ isOpen, onConfirm, onCancel }: DeepSeekConsentModalProps) {
  const { t } = useTranslation('config');
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Risk bullets are authored as an i18n array (returnObjects).
  const risks = t('deepseekConsent.risks', { returnObjects: true }) as string[];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      onBackdropClick={onCancel}
      accent="orange"
      eyebrow={t('deepseekConsent.eyebrow')}
      title={t('deepseekConsent.title')}
      size="md"
      scrollable
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('deepseekConsent.cancel')}
          </Button>
          <Button variant="danger" size="sm" onClick={() => onConfirm(dontShowAgain)}>
            {t('deepseekConsent.confirm')}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)' }}>
        {t('deepseekConsent.intro')}
      </p>

      <ul style={{ margin: '0 0 14px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.isArray(risks) &&
          risks.map((risk, i) => (
            <li key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-2)' }}>
              {risk}
            </li>
          ))}
      </ul>

      <p
        style={{
          margin: '0 0 16px',
          padding: '10px 12px',
          borderRadius: 'var(--r-md)',
          background: 'oklch(94% 0.07 65 / 0.4)',
          border: '1px solid oklch(75% 0.15 65 / 0.5)',
          fontSize: 12.5,
          lineHeight: 1.55,
          color: 'oklch(40% 0.12 55)',
          fontWeight: 600,
        }}
      >
        {t('deepseekConsent.acknowledgement')}
      </p>

      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12.5,
          color: 'var(--text-3)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          checked={dontShowAgain}
          onChange={(e) => setDontShowAgain(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        {t('deepseekConsent.dontShowAgain')}
      </label>
    </Modal>
  );
}
