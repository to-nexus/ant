import { useTranslation } from 'react-i18next';
import { Layers, Terminal, Box } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SectionCard } from '@/presentation/components/ConfigEditor/aurora';

type ChipTone = 'blue' | 'green' | 'purple';

interface ToneCfg {
  bg: string;
  fg: string;
  border: string;
  avatarGrad: string;
}

const TONE_MAP: Record<ChipTone, ToneCfg> = {
  blue: {
    bg: 'oklch(95% 0.04 240 / 0.55)',
    fg: 'oklch(42% 0.14 250)',
    border: 'oklch(85% 0.08 240)',
    avatarGrad:
      'linear-gradient(135deg, oklch(64% 0.18 240), oklch(60% 0.20 260))',
  },
  green: {
    bg: 'oklch(95% 0.05 155 / 0.55)',
    fg: 'oklch(40% 0.14 155)',
    border: 'oklch(85% 0.10 155)',
    avatarGrad:
      'linear-gradient(135deg, oklch(62% 0.18 155), oklch(60% 0.18 175))',
  },
  purple: {
    bg: 'oklch(94% 0.06 290 / 0.55)',
    fg: 'var(--violet-700)',
    border: 'var(--violet-200)',
    avatarGrad: 'var(--gradient-violet-pink)',
  },
};

function ProfileChip({
  label,
  value,
  tone,
  Icon,
  notDetectedLabel,
}: {
  label: string;
  value: string | null | undefined;
  tone: ChipTone;
  Icon: LucideIcon;
  notDetectedLabel: string;
}) {
  const cfg = TONE_MAP[tone];
  const hasValue = !!value;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 12,
        background: hasValue ? cfg.bg : 'var(--bg-surface-2)',
        border: `1px solid ${hasValue ? cfg.border : 'var(--border-2)'}`,
        borderRadius: 'var(--r-md)',
        minWidth: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: 'var(--r-md)',
          background: hasValue ? cfg.avatarGrad : 'var(--bg-surface-3)',
          color: 'white',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={15} strokeWidth={2} />
      </span>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--text-4)',
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
        {hasValue ? (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              fontWeight: 700,
              color: cfg.fg,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={value as string}
          >
            {value}
          </span>
        ) : (
          <span
            style={{
              fontSize: 12,
              fontStyle: 'italic',
              color: 'var(--text-4)',
            }}
          >
            {notDetectedLabel}
          </span>
        )}
      </div>
    </div>
  );
}

export function ProjectProfileSection({
  structureType,
  projectProfile,
}: {
  structureType: string | null;
  projectProfile: { language?: string; framework?: string } | null;
}) {
  const { t } = useTranslation('explorer');
  const notDetected = t('preview.notDetected', '감지되지 않음');

  return (
    <SectionCard
      icon="Layout"
      title={t('preview.projectProfile', '프로젝트 프로파일')}
      description={t(
        'preview.projectProfileDesc',
        '감지된 구조 / 언어 / 프레임워크.',
      )}
      accent="cool"
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
        }}
      >
        <ProfileChip
          label={t('preview.structureType', 'Structure Type')}
          value={structureType}
          tone="blue"
          Icon={Layers}
          notDetectedLabel={notDetected}
        />
        <ProfileChip
          label={t('preview.language', 'Language')}
          value={projectProfile?.language}
          tone="green"
          Icon={Terminal}
          notDetectedLabel={notDetected}
        />
        <ProfileChip
          label={t('preview.framework', 'Framework')}
          value={projectProfile?.framework}
          tone="purple"
          Icon={Box}
          notDetectedLabel={notDetected}
        />
      </div>
    </SectionCard>
  );
}
