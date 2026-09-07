/**
 * GateDecisionForm — approve / reject with the optional reject note. The
 * inbox row and the approver panel used to each carry this pair plus the
 * note textarea; the decision funnel is one, so is its form.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../aurora';
import { Textarea } from '../aurora';

export function GateDecisionForm({
  busy,
  size = 'xs',
  leading,
  onDecide,
}: {
  busy: boolean;
  size?: 'xs' | 'sm';
  /** Rendered before the buttons (e.g. a Details link). */
  leading?: React.ReactNode;
  onDecide: (decision: 'approve' | 'reject', note?: string) => void | Promise<void>;
}) {
  const { t } = useTranslation('pipelines');
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  if (rejecting) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('inbox.rejectNotePlaceholder', 'Reason (optional) — the owner uses it to decide the next move')}
          rows={2}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size={size} variant="danger" disabled={busy} onClick={() => void onDecide('reject', note.trim() || undefined)}>
            {t('inbox.rejectConfirm', 'Confirm reject')}
          </Button>
          <Button size={size} variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
            {t('inbox.rejectCancel', 'Back')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {leading}
      <Button size={size} variant="primary" disabled={busy} onClick={() => void onDecide('approve')}>
        {t('inbox.approve', 'Approve')}
      </Button>
      <Button size={size} variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
        {t('inbox.reject', 'Reject')}
      </Button>
    </div>
  );
}
