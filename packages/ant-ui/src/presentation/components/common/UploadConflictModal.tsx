
/**
 * UploadConflictModal (Aurora) — single + multi-file conflict resolution.
 *
 * Surface: Aurora glass shell with orange accent. Includes a progress
 * indicator row (when multi-file), an "apply to all" toggle, and three
 * actions (Cancel / Keep Copy / Overwrite). Ported from
 * visual/ui/handoff/project/d1-modals.jsx.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { IconOrb } from '../aurora/IconOrb';
import { Icon } from '../aurora/Icon';
import { Toggle } from '../aurora/Toggle';

export type ConflictAction = 'overwrite' | 'copy';
export type ConflictResolution =
  | 'cancel'
  | { perFile: Record<string, ConflictAction> };

export interface UploadConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflictingFiles: string[];
  onResolve: (resolution: ConflictResolution) => void;
}

function ghostButtonStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    padding: '0 16px',
    background: 'oklch(from var(--bg-surface) l c h / 0.7)',
    color: 'var(--text-2)',
    border: '1px solid var(--border-2)',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    fontFamily: 'inherit',
    cursor: 'pointer',
  };
}

function secondaryButtonStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 38,
    padding: '0 18px',
    background: 'oklch(from var(--bg-surface-2) l c h / 0.8)',
    color: 'var(--violet-600)',
    border: '1.5px solid var(--violet-300)',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    fontFamily: 'inherit',
    cursor: 'pointer',
  };
}

function dangerWarningButtonStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 38,
    padding: '0 18px',
    background:
      'linear-gradient(135deg, var(--orange-500), var(--orange-600))',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    fontFamily: 'inherit',
    boxShadow:
      '0 6px 20px oklch(70% 0.18 50 / 0.45), 0 1px 2px rgba(0,0,0,0.1)',
    cursor: 'pointer',
  };
}

export function UploadConflictModal({
  isOpen,
  onClose,
  conflictingFiles,
  onResolve,
}: UploadConflictModalProps) {
  const { t } = useTranslation('artifacts');
  const overwriteBtnRef = useRef<HTMLButtonElement>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [applyToAll, setApplyToAll] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, ConflictAction>>({});

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(0);
      setApplyToAll(false);
      setDecisions({});
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && overwriteBtnRef.current) {
      const timer = setTimeout(() => overwriteBtnRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, currentIndex]);

  const handleCancel = useCallback(() => {
    onResolve('cancel');
    onClose();
  }, [onResolve, onClose]);

  const handleAction = useCallback(
    (action: ConflictAction) => {
      const remaining = conflictingFiles.slice(currentIndex);

      if (applyToAll || remaining.length <= 1) {
        const allDecisions = { ...decisions };
        for (const file of remaining) {
          allDecisions[file] = action;
        }
        onResolve({ perFile: allDecisions });
        onClose();
        return;
      }

      setDecisions((prev) => ({
        ...prev,
        [conflictingFiles[currentIndex]]: action,
      }));
      setCurrentIndex((prev) => prev + 1);
    },
    [applyToAll, conflictingFiles, currentIndex, decisions, onResolve, onClose],
  );

  const isSingleFile = conflictingFiles.length === 1;
  const total = conflictingFiles.length;
  const currentFile = conflictingFiles[currentIndex] ?? '';
  const progressText = `${currentIndex + 1} / ${total}`;
  const remainingCount = Math.max(0, total - currentIndex);
  const progressPct = total === 0 ? 0 : ((currentIndex + 1) / total) * 100;

  const footer = (
    <>
      <button onClick={handleCancel} style={ghostButtonStyle()}>
        {t('common:button.cancel')}
      </button>
      <button onClick={() => handleAction('copy')} style={secondaryButtonStyle()}>
        <Icon name="plus" size={14} />
        {t('conflict.keepCopy')}
      </button>
      <button
        ref={overwriteBtnRef}
        onClick={() => handleAction('overwrite')}
        style={dangerWarningButtonStyle()}
      >
        <Icon name="redo" size={14} />
        {t('conflict.overwrite')}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={t('conflict.title')}
      size="sm"
      accent="orange"
      eyebrow="UPLOAD"
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Icon + message */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <IconOrb type="warning" size={44} />
          <div style={{ flex: 1, paddingTop: 2 }}>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                lineHeight: 1.55,
                color: 'var(--text-2)',
              }}
            >
              {isSingleFile
                ? t('conflict.messageSingle')
                : t('conflict.messageMulti', { count: total })}
            </p>
          </div>
        </div>

        {/* Multi-file progress strip */}
        {!isSingleFile && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              borderRadius: 10,
              background: 'oklch(from var(--violet-100) l c h / 0.45)',
              border: '1px solid var(--violet-200)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--violet-600)',
                letterSpacing: 0.4,
              }}
            >
              {progressText}
            </span>
            <div
              style={{
                flex: 1,
                height: 4,
                borderRadius: 999,
                background: 'oklch(from var(--violet-200) l c h / 0.6)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  background: 'var(--gradient-violet-pink)',
                  borderRadius: 999,
                  transition: 'width var(--dur-base) var(--ease-spring)',
                }}
              />
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {remainingCount}
            </span>
          </div>
        )}

        {/* Current file card */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            background: 'oklch(from var(--bg-surface-2) l c h / 0.8)',
            border: '1px solid var(--border-1)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'var(--gradient-pink-orange)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              flexShrink: 0,
              boxShadow: '0 4px 12px oklch(70% 0.18 50 / 0.30)',
            }}
          >
            <Icon name="file" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--text-3)',
                letterSpacing: 1,
                textTransform: 'uppercase',
                marginBottom: 2,
              }}
            >
              {t('conflict.title')}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-1)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {currentFile}
            </div>
          </div>
        </div>

        {/* Apply to all toggle */}
        {!isSingleFile && remainingCount > 1 && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 10,
              background: applyToAll
                ? 'oklch(from var(--violet-100) l c h / 0.6)'
                : 'transparent',
              border: `1px solid ${
                applyToAll ? 'var(--violet-300)' : 'var(--border-1)'
              }`,
              cursor: 'pointer',
              userSelect: 'none',
              transition: 'transform var(--dur-fast) var(--ease-smooth), opacity var(--dur-fast) var(--ease-smooth), box-shadow var(--dur-fast) var(--ease-smooth)',
            }}
          >
            <Toggle checked={applyToAll} onChange={setApplyToAll} size="sm" />
            <span
              style={{
                fontSize: 13,
                color: 'var(--text-1)',
                fontWeight: 500,
              }}
            >
              {t('conflict.applyToAll', { count: remainingCount })}
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}
