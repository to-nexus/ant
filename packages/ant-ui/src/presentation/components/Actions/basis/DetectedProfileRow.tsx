/**
 * Read-only stand-in for the tier rows that `RUNTIME_SUPPRESSORS` closes on an
 * existing codebase (techTier + visualTier — D27). The stack is a fact the code
 * already decided, so instead of re-prompting we surface what the preview
 * detector observed and keep a low-key manual override link.
 *
 * The profile comes from the app-root `usePreviewSync` (App.tsx), which fetches
 * `GET /preview/projects/:id/status` on every project+feature switch — so this
 * row costs no extra request and does not require visiting the Preview panel.
 */

import { Settings2 } from 'lucide-react';
import { useStore } from '@/domain/store';
import { selectPreviewVM } from '@/domain/store/selectors/previewSelectors';
import { makeFeatureKey } from '@/domain/store/slices/previewSlice';
import { TierBadge, type TierBadgeData } from './TierBadge';

const LABELS = {
  detected: { en: 'Detected', ko: '감지됨' },
  language: { en: 'Language', ko: '언어' },
  framework: { en: 'Framework', ko: '프레임워크' },
  structure: { en: 'Structure', ko: '구조' },
  override: { en: 'Override manually', ko: '수동 재정의' },
  pending: {
    en: 'Auto-detected from the existing codebase',
    ko: '기존 코드베이스에서 자동 감지',
  },
} as const;

interface DetectedProfileRowProps {
  lang: 'en' | 'ko';
  onOverride?: () => void;
}

export function DetectedProfileRow({ lang, onOverride }: DetectedProfileRowProps) {
  const selectedProject = useStore(s => s.selectedProject);
  const selectedFeature = useStore(s => s.selectedFeature);
  const profile = useStore(s =>
    selectPreviewVM(s as any, makeFeatureKey(selectedProject, selectedFeature)).projectProfile,
  );

  const badges: TierBadgeData[] = [];
  if (profile?.language) {
    badges.push({ keyLabel: LABELS.language[lang], label: profile.language, isLocked: true });
  }
  if (profile?.framework) {
    badges.push({ keyLabel: LABELS.framework[lang], label: profile.framework, isLocked: true });
  }
  if (profile?.structureType) {
    badges.push({ keyLabel: LABELS.structure[lang], label: profile.structureType, isLocked: true });
  }

  return (
    <div className="flex items-center gap-2">
      <Settings2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--violet-500)' }} />
      <span
        className="text-[10px] font-semibold shrink-0"
        style={{ color: 'var(--text-3)' }}
      >
        {LABELS.detected[lang]}
      </span>
      <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-hide">
        {badges.length > 0 ? (
          badges.map((badge, idx) => (
            <TierBadge key={idx} badge={badge} variant="techTier" />
          ))
        ) : (
          // Not a loading state — the profile is optional extra detail, so no
          // spinner / skeleton (async policy).
          <span className="text-xs italic" style={{ color: 'var(--text-3)' }}>
            {LABELS.pending[lang]}
          </span>
        )}
      </div>
      {onOverride && (
        <button
          type="button"
          onClick={onOverride}
          className="shrink-0 text-xs transition-colors hover:text-[color:var(--text-2)]"
          style={{ color: 'var(--text-3)' }}
        >
          {LABELS.override[lang]}
        </button>
      )}
    </div>
  );
}
