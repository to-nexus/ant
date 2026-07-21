import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/presentation/components/common/Modal';
import { Icon } from '@/presentation/components/aurora/Icon';

interface CommitDecisionModalProps {
  isOpen: boolean;
  /** Number of changed files being committed (for the header hint). */
  fileCount: number;
  onCancel: () => void;
  /** User-authored path: commit with the typed message. */
  onUserCommit: (message: string) => void;
  /** ant-authored path: an LLM writes the message(s). */
  onAntCommit: () => void;
}

type Mode = 'ant' | 'user';

/**
 * Commit decision modal (E6-1). Offers two peer paths: let ant (an auxiliary
 * LLM) author the commit message(s), or write the message yourself. Rendered
 * on top of the base Aurora `Modal` — the two paths are peer actions, not a
 * confirm/cancel, so they live in the body + footer rather than `AlertModal`.
 */
export function CommitDecisionModal({
  isOpen,
  fileCount,
  onCancel,
  onUserCommit,
  onAntCommit,
}: CommitDecisionModalProps) {
  const { t } = useTranslation('explorer');
  const [mode, setMode] = useState<Mode>('ant');
  const [message, setMessage] = useState('');

  // Reset to the recommended (ant) path each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setMode('ant');
      setMessage('');
    }
  }, [isOpen]);

  const canCommit = mode === 'ant' || message.trim().length > 0;

  const submit = () => {
    if (mode === 'ant') {
      onAntCommit();
    } else if (message.trim()) {
      onUserCommit(message.trim());
    }
  };

  const optionCard = (value: Mode, icon: string, title: string, desc: string) => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => setMode(value)}
        style={{
          flex: 1,
          textAlign: 'left',
          padding: '12px 14px',
          borderRadius: 'var(--r-lg)',
          border: `1px solid ${active ? 'var(--violet-500)' : 'var(--border-1)'}`,
          background: active ? 'oklch(94% 0.06 290 / 0.25)' : 'var(--bg-surface)',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name={icon} size={15} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{title}</span>
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.4 }}>{desc}</span>
      </button>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={t('git.commitModal.title')}
      eyebrow={t('git.commitModal.eyebrow', { count: fileCount })}
      accent="violet"
      size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border-1)',
              background: 'transparent',
              color: 'var(--text-2)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('common:actions.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canCommit}
            style={{
              padding: '8px 18px',
              borderRadius: 'var(--r-md)',
              border: 'none',
              background: canCommit ? 'var(--gradient-violet-pink)' : 'var(--bg-surface-2)',
              color: canCommit ? '#fff' : 'var(--text-4)',
              fontWeight: 700,
              cursor: canCommit ? 'pointer' : 'not-allowed',
            }}
          >
            {t('git.commitModal.commit')}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {optionCard('ant', 'Sparkles', t('git.commitModal.antTitle'), t('git.commitModal.antDesc'))}
          {optionCard('user', 'PenLine', t('git.commitModal.userTitle'), t('git.commitModal.userDesc'))}
        </div>

        {mode === 'user' && (
          <textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('git.commitModal.messagePlaceholder')}
            rows={4}
            style={{
              width: '100%',
              resize: 'vertical',
              padding: '10px 12px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border-1)',
              background: 'var(--bg-surface)',
              color: 'var(--text-1)',
              fontSize: 13,
              fontFamily: 'var(--font-mono, monospace)',
            }}
          />
        )}
      </div>
    </Modal>
  );
}
