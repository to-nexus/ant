
/**
 * AuroraCases.tsx — Dev-only case index for the Aurora redesign handoff.
 *
 * Renders the 10 Aurora handoff HTML files (visual/ui/handoff/project/*.html)
 * in side-by-side iframes for visual diffing against the real ant-ui.
 *
 * Lifecycle:
 * - Mounted ONLY via `<Route path="/dev/aurora-cases">` in App.tsx, which is
 *   itself gated by `import.meta.env.DEV`. The lazy import in App.tsx is also
 *   `DEV`-gated, so Rollup tree-shakes this entire module in production.
 * - As second-line defence the component renders a "not available" stub when
 *   `import.meta.env.DEV` is false at render time.
 *
 * Iframe sources point at `/dev-cases/<filename>.html` — served by the
 * `auroraCasesDevStatic()` Vite plugin (vite.config.ts) ONLY during
 * `vite dev`. Production builds do not include these assets.
 */

import { useEffect, useState } from 'react';

type Density = 'comfy' | 'compact';
type Series = 'A' | 'B' | 'C' | 'D';
type Tone = 'aurora' | 'violet' | 'pink' | 'orange' | 'cool';
type Surface = 'shell' | 'explorer' | 'panel' | 'editor' | 'overlay';

interface CaseSpec {
  id: string;
  title: string;
  file: string;
  series: Series;
  tone: Tone;
  summary: string;
  mapping: string;
  surface: Surface;
}

interface SeriesSpec {
  id: Series;
  label: string;
  title: string;
  blurb: string;
}

const CASES: CaseSpec[] = [
  {
    id: 'A1', title: 'QuickStart', file: 'A1 - QuickStart.html',
    series: 'A', tone: 'aurora',
    summary: '온보딩 화면 — 브랜드 히어로 + 첫 진입 CTA.',
    mapping: 'pages/QuickStart.tsx · i18n/locales/ko/onboarding.json',
    surface: 'shell',
  },
  {
    id: 'A2', title: 'Workspace', file: 'A2 - Workspace.html',
    series: 'A', tone: 'violet',
    summary: '메인 3-pane 셸 — Explorer · MainPanel · Chat.',
    mapping: 'App.tsx · layout/* · MainPanel · kanban/* · workflow/*',
    surface: 'shell',
  },
  {
    id: 'A3', title: 'Chat Panel', file: 'A3 - Chat Panel.html',
    series: 'A', tone: 'pink',
    summary: '채팅 + 카드 시스템 — pinned query, thinking block, action cards.',
    mapping: 'chat/* 풀 세트 (ChatPanel, MessageList, ChatInputShell, …)',
    surface: 'shell',
  },
  {
    id: 'B3', title: 'Explorer Panel', file: 'B3 - Explorer Panel.html',
    series: 'B', tone: 'violet',
    summary: 'Project / Feature row 리스트 + Git 툴바 + Artifacts.',
    mapping: 'layout/ExplorerPanel.tsx · ProjectSection · FeatureSection/*',
    surface: 'explorer',
  },
  {
    id: 'C1', title: 'Actions Panel', file: 'C1 - Actions Panel.html',
    series: 'C', tone: 'pink',
    summary: '풀-그라데이션 액션 칩 + Basis Wizard + compact ChipGrid.',
    mapping: 'Actions/* · Actions/basis/* · chat/ActionsCTA',
    surface: 'panel',
  },
  {
    id: 'C2', title: 'ProjectWizardModal', file: 'C2 - ProjectWizardModal.html',
    series: 'C', tone: 'aurora',
    summary: '글래스 모달 + Aurora halo. 단계 인디케이터 emerald ✓ + violet ring.',
    mapping: 'ProjectWizardModal/{ProjectWizardModal,StepProjectSetup,…}',
    surface: 'overlay',
  },
  {
    id: 'C3', title: 'Config Editors', file: 'C3 - Config Editors.html',
    series: 'C', tone: 'violet',
    summary: 'Sticky TOC + Project · Account · Preview Config editors.',
    mapping: 'ConfigEditor/* · AccountConfigEditor.tsx · PreviewConfigEditor/*',
    surface: 'editor',
  },
  {
    id: 'C4', title: 'File Editor + IDE', file: 'C4 - File Editor + IDE.html',
    series: 'C', tone: 'cool',
    summary: 'FileEditor · VirtualDocumentViewer · IdeFrame (5 라이프사이클 상태).',
    mapping: 'FileEditorPanel.tsx · VirtualDocumentViewer.tsx · IDE iframe chrome',
    surface: 'editor',
  },
  {
    id: 'D1', title: 'Modals + Toasts', file: 'D1 - Modals + Toasts.html',
    series: 'D', tone: 'orange',
    summary: 'AlertModal · UploadConflict · DesktopConnect · Toast — 5개 오버레이.',
    mapping: 'common/{AlertModal,Toast,Modal,UploadConflictModal} · useDesktopBridge.ts',
    surface: 'overlay',
  },
  {
    id: 'DS', title: 'Aurora Design System', file: 'Aurora Design System.html',
    series: 'D', tone: 'aurora',
    summary: '토큰 · 컴포넌트 · 패턴 — Color · Type · Spacing · Motion.',
    mapping: '디자인 토큰 SSOT · 모든 케이스의 시각 기반',
    surface: 'overlay',
  },
];

const SERIES_LIST: SeriesSpec[] = [
  { id: 'A', label: '셸',         title: 'Workspace shell',   blurb: '온보딩 · 메인 레이아웃 · 채팅' },
  { id: 'B', label: '익스플로러', title: 'Explorer',          blurb: '프로젝트 · 피처 · 아티팩트' },
  { id: 'C', label: '패널 · 에디터', title: 'Panels & Editors', blurb: '액션 · 위저드 · 컨피그 · 파일' },
  { id: 'D', label: '오버레이',   title: 'Overlays · System', blurb: '모달 · 토스트 · 디자인 시스템' },
];

const TONE_HALO: Record<Tone, string> = {
  aurora: 'var(--gradient-aurora)',
  violet: 'var(--gradient-violet-pink)',
  pink:   'var(--gradient-pink-orange)',
  orange: 'linear-gradient(135deg, var(--orange-400), var(--pink-400))',
  cool:   'var(--gradient-cool)',
};

const TONE_CHIP: Record<Tone, string> = {
  aurora: 'var(--violet-600)',
  violet: 'var(--violet-600)',
  pink:   'var(--pink-600)',
  orange: 'var(--orange-600)',
  cool:   'oklch(48% 0.15 195)',
};

const SURFACE_LABEL: Record<Surface, string> = {
  shell: 'Shell',
  explorer: 'Explorer',
  panel: 'Panel',
  editor: 'Editor',
  overlay: 'Overlay',
};

function caseSrc(file: string): string {
  return `/dev-cases/${encodeURIComponent(file)}`;
}

interface TopNavProps {
  theme: 'light' | 'dark';
  onTheme: (next: 'light' | 'dark') => void;
  density: Density;
  onDensity: (next: Density) => void;
}

function TopNav({ theme, onTheme, density, onDensity }: TopNavProps) {
  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        padding: '12px 28px',
        background: 'oklch(from var(--bg-canvas) l c h / 0.78)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '1px solid var(--border-1)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 11,
            background: 'var(--gradient-aurora)',
            backgroundSize: '200% 200%',
            boxShadow: 'var(--shadow-glow-aurora)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 800,
            fontSize: 14,
            letterSpacing: '-0.04em',
          }}
        >
          A
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, lineHeight: 1.1 }}>
          <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--text-1)' }}>
            Aurora
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-3)', letterSpacing: 0.2 }}>
            for Ant · 케이스 인덱스 (DEV)
          </span>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', gap: 4 }}>
        {SERIES_LIST.map((s) => (
          <a
            key={s.id}
            href={`#series-${s.id}`}
            style={{
              padding: '7px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-3)',
              textDecoration: 'none',
              transition: 'all var(--dur-fast) var(--ease-smooth)',
            }}
          >
            {s.id} · {s.label}
          </a>
        ))}
      </div>

      <div style={{ width: 1, height: 22, background: 'var(--border-1)', margin: '0 4px' }} />

      <div
        style={{
          display: 'inline-flex',
          padding: 3,
          borderRadius: 999,
          background: 'oklch(from var(--bg-surface) l c h / 0.85)',
          border: '1px solid var(--border-2)',
          gap: 2,
        }}
        role="group"
        aria-label="Density"
      >
        {(['comfy', 'compact'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDensity(d)}
            style={{
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              border: 'none',
              background: density === d ? 'var(--gradient-aurora)' : 'transparent',
              color: density === d ? 'white' : 'var(--text-3)',
              transition: 'all var(--dur-fast)',
            }}
          >
            {d === 'comfy' ? 'Comfy' : 'Compact'}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onTheme(theme === 'light' ? 'dark' : 'light')}
        title="Toggle theme"
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: 'oklch(from var(--bg-surface) l c h / 0.85)',
          border: '1px solid var(--border-2)',
          color: 'var(--text-2)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
        }}
      >
        {theme === 'light' ? '🌙' : '☀'}
      </button>
    </nav>
  );
}

function Hero() {
  const stats = [
    { label: '케이스', value: String(CASES.length) },
    { label: '시리즈', value: '4' },
    { label: '디자인 토큰', value: '120+' },
    { label: '컴포넌트 파일', value: '17' },
  ];
  return (
    <section style={{ position: 'relative', padding: '64px 36px 48px', maxWidth: 1320, margin: '0 auto' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 14px',
          borderRadius: 999,
          background: 'oklch(from var(--bg-surface) l c h / 0.6)',
          border: '1px solid var(--border-1)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: 'var(--violet-600)',
          marginBottom: 22,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gradient-aurora)' }} />
        Ant UI 리디자인 · Aurora · Side-by-side diff
      </div>

      <h1
        style={{
          margin: 0,
          fontSize: 'clamp(36px, 5.5vw, 64px)',
          fontWeight: 800,
          lineHeight: 1.02,
          letterSpacing: '-0.035em',
          maxWidth: 980,
          color: 'var(--text-1)',
        }}
      >
        <span>케이스 정답지 vs </span>
        <span
          style={{
            background: 'var(--gradient-aurora)',
            backgroundSize: '200% 200%',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          실제 구현
        </span>
        <span>.</span>
      </h1>

      <p style={{ margin: '20px 0 0', fontSize: 16, color: 'var(--text-3)', maxWidth: 680, lineHeight: 1.55 }}>
        <code
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.85em',
            padding: '2px 7px',
            borderRadius: 6,
            background: 'oklch(from var(--bg-surface-2) l c h / 0.6)',
            border: '1px solid var(--border-1)',
          }}
        >
          visual/ui/handoff/project/*.html
        </code>
        의 10개 정답지를 dev server static path로 서빙해 iframe으로 비교합니다.
        prod 빌드에는 포함되지 않습니다.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14, marginTop: 36, maxWidth: 720 }}>
        {stats.map((s) => (
          <div
            key={s.label}
            style={{
              padding: '16px 18px',
              borderRadius: 16,
              background: 'oklch(from var(--bg-surface) l c h / 0.65)',
              border: '1px solid var(--border-1)',
              boxShadow: 'var(--shadow-xs)',
            }}
          >
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                background: 'var(--gradient-aurora)',
                backgroundSize: '200% 200%',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                lineHeight: 1,
              }}
            >
              {s.value}
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-3)',
                letterSpacing: 0.4,
                marginTop: 4,
                textTransform: 'uppercase',
              }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface CaseCardProps {
  spec: CaseSpec;
  density: Density;
}

function CaseCard({ spec, density }: CaseCardProps) {
  const halo = TONE_HALO[spec.tone];
  const chip = TONE_CHIP[spec.tone];
  const src = caseSrc(spec.file);
  const iframeHeight = density === 'compact' ? 360 : 520;

  return (
    <article
      style={{
        position: 'relative',
        borderRadius: 22,
        background: 'oklch(from var(--bg-surface) l c h / 0.75)',
        backdropFilter: 'blur(10px) saturate(160%)',
        WebkitBackdropFilter: 'blur(10px) saturate(160%)',
        border: '1px solid var(--border-1)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: density === 'compact' ? 14 : 18 }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 42,
              height: 42,
              borderRadius: 12,
              background: halo,
              backgroundSize: '200% 200%',
              color: 'white',
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: '-0.03em',
              flexShrink: 0,
            }}
          >
            {spec.id}
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: '-0.015em',
                  color: 'var(--text-1)',
                  lineHeight: 1.2,
                }}
              >
                {spec.title}
              </h3>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: 'uppercase',
                  color: chip,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'oklch(from var(--bg-surface-2) l c h / 0.6)',
                }}
              >
                {SURFACE_LABEL[spec.surface]}
              </span>
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                style={{
                  marginLeft: 'auto',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--violet-600)',
                  textDecoration: 'none',
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--border-2)',
                  background: 'oklch(from var(--bg-surface) l c h / 0.85)',
                }}
              >
                새 탭 ↗
              </a>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
              {spec.summary}
            </p>
          </div>
        </header>

        <div
          style={{
            marginBottom: 12,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'oklch(from var(--bg-surface-2) l c h / 0.5)',
            border: '1px solid var(--border-1)',
          }}
        >
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              color: 'var(--text-3)',
              lineHeight: 1.55,
              wordBreak: 'break-word',
            }}
          >
            {spec.mapping}
          </code>
        </div>

        <iframe
          src={src}
          title={`${spec.id} — ${spec.title}`}
          loading="lazy"
          style={{
            display: 'block',
            width: '100%',
            height: iframeHeight,
            border: '1px solid var(--border-1)',
            borderRadius: 12,
            background: 'var(--bg-surface)',
          }}
        />
      </div>
    </article>
  );
}

interface SeriesSectionProps {
  series: SeriesSpec;
  cards: CaseSpec[];
  density: Density;
}

function SeriesSection({ series, cards, density }: SeriesSectionProps) {
  if (cards.length === 0) return null;
  const minCol = density === 'compact' ? 360 : 420;
  return (
    <section
      id={`series-${series.id}`}
      style={{ padding: '8px 36px 56px', maxWidth: 1320, margin: '0 auto' }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              color: 'var(--violet-600)',
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: '-0.04em',
                background: 'var(--gradient-aurora)',
                backgroundSize: '200% 200%',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                lineHeight: 1,
              }}
            >
              {series.id}
            </span>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                background: 'oklch(from var(--bg-surface) l c h / 0.8)',
                border: '1px solid var(--border-1)',
                color: 'var(--violet-600)',
              }}
            >
              {series.label}
            </span>
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--text-1)',
            }}
          >
            {series.title}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-3)' }}>
            {series.blurb}
          </p>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
          {cards.length}개 케이스
        </div>
      </header>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${minCol}px, 1fr))`,
          gap: 18,
        }}
      >
        {cards.map((c) => (
          <CaseCard key={c.id} spec={c} density={density} />
        ))}
      </div>
    </section>
  );
}

export default function AuroraCases() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const current = document.documentElement.dataset.theme;
    return current === 'dark' ? 'dark' : 'light';
  });
  const [density, setDensity] = useState<Density>('comfy');

  useEffect(() => {
    const previous = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = theme;
    return () => {
      if (previous === undefined) {
        delete document.documentElement.dataset.theme;
      } else {
        document.documentElement.dataset.theme = previous;
      }
    };
  }, [theme]);

  // Second-line defence: even if a misconfigured prod build somehow renders
  // this component, refuse to expose iframe paths that won't resolve.
  // `import.meta.env.DEV` is a build-time constant so this branch is
  // statically eliminated in prod builds; hook order remains stable.
  if (!import.meta.env.DEV) {
    return (
      <div style={{ padding: 24, color: 'var(--text-3)' }}>
        Aurora case index is not available in production builds.
      </div>
    );
  }

  const grouped = SERIES_LIST.map((s) => ({
    series: s,
    cards: CASES.filter((c) => c.series === s.id),
  }));

  return (
    <div style={{ position: 'relative', isolation: 'isolate', minHeight: '100vh', background: 'var(--bg-canvas)' }}>
      <TopNav theme={theme} onTheme={setTheme} density={density} onDensity={setDensity} />
      <Hero />
      {grouped.map((g) => (
        <SeriesSection key={g.series.id} series={g.series} cards={g.cards} density={density} />
      ))}
      <footer
        style={{
          padding: '40px 36px 56px',
          maxWidth: 1320,
          margin: '0 auto',
          borderTop: '1px solid var(--border-1)',
          color: 'var(--text-4)',
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--text-2)' }}>Aurora for Ant</span>
        <span style={{ margin: '0 8px' }}>·</span>
        Dev-only · <code style={{ fontFamily: 'var(--font-mono)' }}>/dev/aurora-cases</code> ·
        <code style={{ fontFamily: 'var(--font-mono)', marginLeft: 4 }}>visual/ui/handoff/project/</code>
      </footer>
    </div>
  );
}
