import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Invite deep link for a token — same-origin app entry. */
export function inviteLinkFor(token: string): string {
  return `${window.location.origin}/app/?invite=${encodeURIComponent(token)}`;
}

/**
 * Copyable invite-link chip — mono URL + Copy↔Check (1500ms) affordance.
 * We never send emails; the admin relays this link themselves.
 */
export function InviteLinkChip({ token }: { token: string }) {
  const { t } = useTranslation('config');
  const [copied, setCopied] = useState(false);
  const link = inviteLinkFor(token);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the URL is selectable text */
    }
  };

  return (
    <div
      className="flex items-center gap-2 rounded px-2 py-1.5 min-w-0"
      style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)' }}
    >
      <span
        className="truncate select-all"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs, 11px)', color: 'var(--text-2)' }}
        title={link}
      >
        {link}
      </span>
      <button
        onClick={copy}
        aria-live="polite"
        aria-label={t('org.invites.copyLink', 'Copy invite link')}
        className="shrink-0 p-1 rounded"
        style={{ color: copied ? 'var(--emerald-400, #34d399)' : 'var(--text-3)' }}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
