/**
 * "Add existing" picker (intent scope) — an inline panel listing the job's
 * injections/*.md files not yet bound to the selected intent. Picking one
 * binds it (intents draft → ChangedBar); files are never copied or moved.
 */

import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { Button } from '@/presentation/components/aurora';

export interface AddExistingPickerProps {
  /** Bare file names of the job's injections/*.md not bound to this intent. */
  candidates: string[];
  /** file name → number of OTHER intents already inlining it. */
  boundCountOf: (fileName: string) => number;
  onPick: (fileName: string) => void;
  onCancel: () => void;
}

export function AddExistingPicker({ candidates, boundCountOf, onPick, onCancel }: AddExistingPickerProps) {
  const { t } = useTranslation('agents');

  return (
    <div
      className="flex flex-col gap-1 p-2 rounded-md"
      style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)' }}
    >
      {candidates.length === 0 ? (
        <p className="m-0 text-xs" style={{ color: 'var(--text-4)', lineHeight: 1.5 }}>
          {t(
            'prompts.addExistingEmpty',
            'No unbound injections/*.md files in this job — a new file created here is bound automatically.',
          )}
        </p>
      ) : (
        candidates.map((fileName) => {
          const others = boundCountOf(fileName);
          return (
            <button
              key={fileName}
              type="button"
              className="flex items-center gap-1.5 py-1 px-1.5 rounded text-xs text-left hover:bg-[color:var(--bg-hover)]"
              style={{ color: 'var(--text-2)' }}
              onClick={() => onPick(fileName)}
            >
              <FileText className="w-3 h-3 shrink-0" />
              <span className="truncate flex-1" style={{ fontFamily: 'var(--font-mono)' }}>
                {fileName}
              </span>
              {others > 0 && (
                <span
                  className="shrink-0"
                  style={{
                    fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                    padding: '1px 7px',
                    borderRadius: 'var(--r-pill)',
                    border: '1px solid var(--violet-300)',
                    color: 'var(--select-fg)',
                    background: 'var(--select-fill-violet)',
                  }}
                >
                  {t('prompts.otherIntents', '{{count}} intent(s)', { count: others })}
                </span>
              )}
            </button>
          );
        })
      )}
      <div>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('tree.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
}
