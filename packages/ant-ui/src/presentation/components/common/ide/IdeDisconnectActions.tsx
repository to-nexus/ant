import { useTranslation } from 'react-i18next';
import { IdeForceResetButton } from './IdeForceResetButton';

export interface IdeDisconnectActionsProps {
  onReconnect: () => void | Promise<void>;
  onRestart: () => void | Promise<void>;
  onForceReset: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
}

/**
 * Two-column "what you can do" vs "what we can't do" layout, the centerpiece
 * of the disconnected/failed overlay. The actions correspond 1:1 to the 4
 * UISlice methods (`requestReconnect` / `startIdeSession` / `forceResetIdeSession`
 * / `closeIdeSession`) — the parent wires them.
 *
 * The right column is educational copy only (no buttons) — it tells the user
 * the boundaries of ANT's control surface (VSCode iframe internals, browser
 * isolation, K8s direct access). Educates rather than just promising actions.
 */
export function IdeDisconnectActions({
  onReconnect,
  onRestart,
  onForceReset,
  onClose,
}: IdeDisconnectActionsProps) {
  const { t } = useTranslation('async');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-3)] mb-3">
          {t('ide.disconnected.canDo.heading')}
        </h4>
        <ul className="space-y-3">
          <li>
            <ActionRow
              label={t('ide.disconnected.canDo.reconnect.label')}
              desc={t('ide.disconnected.canDo.reconnect.desc')}
              onClick={onReconnect}
            />
          </li>
          <li>
            <ActionRow
              label={t('ide.disconnected.canDo.restart.label')}
              desc={t('ide.disconnected.canDo.restart.desc')}
              onClick={onRestart}
            />
          </li>
          <li className="pt-1">
            <div className="flex items-start gap-3">
              <IdeForceResetButton onConfirm={onForceReset} emphasized />
              <p className="text-xs text-[color:var(--text-3)] flex-1 mt-1">
                {t('ide.disconnected.canDo.forceReset.desc')}
              </p>
            </div>
          </li>
          <li>
            <ActionRow
              label={t('ide.disconnected.canDo.close.label')}
              desc={t('ide.disconnected.canDo.close.desc')}
              onClick={onClose}
              tone="muted"
            />
          </li>
        </ul>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-3)] mb-3">
          {t('ide.disconnected.cannotDo.heading')}
        </h4>
        <ul className="space-y-3 text-sm text-[color:var(--text-3)]">
          <CannotDoRow>{t('ide.disconnected.cannotDo.vscodeReconnect')}</CannotDoRow>
          <CannotDoRow>{t('ide.disconnected.cannotDo.unsavedBuffer')}</CannotDoRow>
          <CannotDoRow>{t('ide.disconnected.cannotDo.directKubectl')}</CannotDoRow>
        </ul>
      </div>
    </div>
  );
}

function ActionRow({
  label,
  desc,
  onClick,
  tone = 'default',
}: {
  label: string;
  desc: string;
  onClick: () => void | Promise<void>;
  tone?: 'default' | 'muted';
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        onClick={() => void onClick()}
        className={
          tone === 'muted'
            ? 'inline-flex items-center shrink-0 px-3 py-1.5 text-sm rounded-md text-[color:var(--text-2)] border border-transparent hover:bg-gray-100 transition-colors'
            : 'inline-flex items-center shrink-0 px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white text-[color:var(--text-2)] hover:bg-gray-50 transition-colors'
        }
      >
        {label}
      </button>
      <p className="text-xs text-[color:var(--text-3)] flex-1 mt-1">{desc}</p>
    </div>
  );
}

function CannotDoRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" className="text-[color:var(--text-4)] shrink-0">ⓘ</span>
      <span>{children}</span>
    </li>
  );
}
