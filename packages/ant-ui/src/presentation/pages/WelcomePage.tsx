import { useTranslation } from 'react-i18next';
import { Lightbulb, Code2, Users, ArrowRight } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useEffect, useRef } from 'react';

export interface WelcomePageProps {
  onSignUp: () => void;
  onSignIn: () => void;
}

// ─── Starfield Canvas ───────────────────────────────────────────────
// Renders animated shooting stars + twinkling background stars on a <canvas>.
// Entirely self-contained — mounts/unmounts with the component.
function StarfieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = 0;
    let height = 0;

    // ── Background stars (twinkling) ──
    interface Star {
      x: number;
      y: number;
      r: number;
      alpha: number;
      dAlpha: number;
    }
    let stars: Star[] = [];

    // ── Shooting stars ──
    interface Shooter {
      x: number;
      y: number;
      len: number;
      speed: number;
      angle: number;
      alpha: number;
      width: number;
      life: number;
      maxLife: number;
    }
    let shooters: Shooter[] = [];

    function resize() {
      width = canvas!.clientWidth;
      height = canvas!.clientHeight;
      canvas!.width = width * devicePixelRatio;
      canvas!.height = height * devicePixelRatio;
      ctx!.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      initStars();
    }

    function initStars() {
      const count = Math.floor((width * height) / 6000);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.2 + 0.3,
        alpha: Math.random(),
        dAlpha: (Math.random() - 0.5) * 0.02,
      }));
    }

    function spawnShooter() {
      // Start from top/right area, move toward bottom-left
      const angle = Math.PI * (0.55 + Math.random() * 0.35); // ~100°-160°
      shooters.push({
        x: width * (0.3 + Math.random() * 0.7),
        y: -10 + Math.random() * height * 0.3,
        len: 60 + Math.random() * 100,
        speed: 4 + Math.random() * 6,
        angle,
        alpha: 0.7 + Math.random() * 0.3,
        width: 1 + Math.random() * 1.5,
        life: 0,
        maxLife: 60 + Math.random() * 60,
      });
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);

      // ── Draw twinkling stars ──
      for (const s of stars) {
        s.alpha += s.dAlpha;
        if (s.alpha <= 0.1 || s.alpha >= 1) s.dAlpha *= -1;
        s.alpha = Math.max(0.1, Math.min(1, s.alpha));

        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(200,210,255,${s.alpha * 0.6})`;
        ctx!.fill();
      }

      // ── Draw shooting stars ──
      for (let i = shooters.length - 1; i >= 0; i--) {
        const sh = shooters[i];
        sh.x += Math.cos(sh.angle) * sh.speed;
        sh.y += Math.sin(sh.angle) * sh.speed;
        sh.life++;

        // Fade in at start, fade out at end
        const progress = sh.life / sh.maxLife;
        const fade = progress < 0.1 ? progress / 0.1 : progress > 0.7 ? (1 - progress) / 0.3 : 1;
        const a = sh.alpha * fade;

        // Tail
        const tailX = sh.x - Math.cos(sh.angle) * sh.len;
        const tailY = sh.y - Math.sin(sh.angle) * sh.len;

        const grad = ctx!.createLinearGradient(tailX, tailY, sh.x, sh.y);
        grad.addColorStop(0, `rgba(180,200,255,0)`);
        grad.addColorStop(0.6, `rgba(200,215,255,${a * 0.3})`);
        grad.addColorStop(1, `rgba(220,230,255,${a})`);

        ctx!.beginPath();
        ctx!.moveTo(tailX, tailY);
        ctx!.lineTo(sh.x, sh.y);
        ctx!.strokeStyle = grad;
        ctx!.lineWidth = sh.width;
        ctx!.lineCap = 'round';
        ctx!.stroke();

        // Glow head
        const headGlow = ctx!.createRadialGradient(sh.x, sh.y, 0, sh.x, sh.y, 4);
        headGlow.addColorStop(0, `rgba(230,240,255,${a})`);
        headGlow.addColorStop(1, `rgba(230,240,255,0)`);
        ctx!.beginPath();
        ctx!.arc(sh.x, sh.y, 4, 0, Math.PI * 2);
        ctx!.fillStyle = headGlow;
        ctx!.fill();

        // Remove expired
        if (sh.life >= sh.maxLife || sh.x < -100 || sh.y > height + 100) {
          shooters.splice(i, 1);
        }
      }

      // Randomly spawn shooters
      if (Math.random() < 0.025 && shooters.length < 4) {
        spawnShooter();
      }

      animId = requestAnimationFrame(draw);
    }

    resize();
    // Spawn one immediately so there's something visible right away
    spawnShooter();
    draw();

    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.85 }}
    />
  );
}

// ─── Floating orbs (CSS-only) ───────────────────────────────────────
// Slow-drifting, blurred gradient orbs for ambient depth.
function FloatingOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Orb 1 — indigo, top-left drift */}
      <div
        className="absolute w-[500px] h-[500px] rounded-full blur-[100px] opacity-30 dark:opacity-20"
        style={{
          background: 'radial-gradient(circle, rgba(99,102,241,0.5) 0%, transparent 70%)',
          top: '10%',
          left: '15%',
          animation: 'orbFloat1 20s ease-in-out infinite',
        }}
      />
      {/* Orb 2 — purple, center-right */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full blur-[120px] opacity-25 dark:opacity-15"
        style={{
          background: 'radial-gradient(circle, rgba(168,85,247,0.4) 0%, transparent 70%)',
          top: '30%',
          right: '10%',
          animation: 'orbFloat2 25s ease-in-out infinite',
        }}
      />
      {/* Orb 3 — teal/emerald accent near CTA */}
      <div
        className="absolute w-[400px] h-[400px] rounded-full blur-[80px] opacity-20 dark:opacity-15"
        style={{
          background: 'radial-gradient(circle, rgba(20,184,166,0.4) 0%, transparent 70%)',
          bottom: '15%',
          left: '40%',
          animation: 'orbFloat3 18s ease-in-out infinite',
        }}
      />
    </div>
  );
}

// ─── Grid overlay ───────────────────────────────────────────────────
// A subtle dot-grid that adds depth (like a blueprint/spec feel).
function GridOverlay() {
  return (
    <div
      className="absolute inset-0 pointer-events-none opacity-[0.04] dark:opacity-[0.06]"
      style={{
        backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }}
    />
  );
}

// ─── Main Component ─────────────────────────────────────────────────
export function WelcomePage({ onSignUp, onSignIn }: WelcomePageProps) {
  const { t } = useTranslation('onboarding');
  const theme = useStore((state) => state.theme);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-indigo-50 dark:from-[#0d1117] dark:via-[#0d1117] dark:to-[#110d20] transition-colors pt-16 flex flex-col relative overflow-hidden">
      {/* === Background layers === */}
      <GridOverlay />
      <FloatingOrbs />
      <div className="absolute inset-0 pt-16">
        <StarfieldCanvas />
      </div>

      {/* === Inline keyframes for orb drift (no tailwind config needed) === */}
      <style>{`
        @keyframes orbFloat1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(40px, -30px) scale(1.05); }
          66% { transform: translate(-20px, 20px) scale(0.95); }
        }
        @keyframes orbFloat2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-50px, 30px) scale(1.08); }
          66% { transform: translate(30px, -40px) scale(0.92); }
        }
        @keyframes orbFloat3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(30px, -25px) scale(1.1); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.95) translateY(12px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      {/* === Main content === */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-6 z-10">
        {/* Hero section */}
        <div
          className="text-center max-w-3xl mx-auto mb-16"
          style={{ animation: 'fadeInUp 0.8s ease-out both' }}
        >
          {/* Logo accent */}
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-8 rounded-full bg-indigo-100/80 dark:bg-indigo-900/40 border border-indigo-200/60 dark:border-indigo-700/40 backdrop-blur-sm">
            <img
              src={theme === 'dark' ? '/logo-dark.svg' : '/logo-light.svg'}
              alt="ANT"
              className="w-5 h-5"
            />
            <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
              ANT Works
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white leading-tight mb-6 whitespace-pre-line">
            {t('welcome.headline')}
          </h1>

          {/* Subheadline */}
          <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            {t('welcome.subheadline')}
          </p>

          {/* CTA */}
          <div className="flex flex-col items-center gap-4">
            <button
              onClick={onSignUp}
              className="group relative inline-flex items-center gap-2 px-8 py-4 text-lg font-semibold text-white
                       bg-gradient-to-r from-emerald-500 to-teal-600
                       hover:from-emerald-600 hover:to-teal-700
                       dark:from-emerald-400 dark:to-teal-500
                       dark:hover:from-emerald-500 dark:hover:to-teal-600
                       rounded-xl shadow-lg shadow-emerald-500/25 dark:shadow-emerald-400/20
                       hover:shadow-xl hover:shadow-emerald-500/30
                       transform hover:scale-[1.02] active:scale-[0.98]
                       transition-all duration-200 overflow-hidden"
            >
              {/* Button glow effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              <span className="relative">{t('welcome.getStarted')}</span>
              <ArrowRight className="relative w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>

            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('welcome.alreadyHaveAccount')}{' '}
              <button
                onClick={onSignIn}
                className="font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 underline underline-offset-2 transition-colors"
              >
                {t('welcome.signIn')}
              </button>
            </p>
          </div>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto w-full">
          <div style={{ animation: 'fadeInScale 0.6s ease-out 0.2s both' }}>
            <FeatureCard
              icon={<Lightbulb className="w-6 h-6" />}
              title={t('welcome.feature1')}
              description={t('welcome.feature1Desc')}
              accent="indigo"
            />
          </div>
          <div style={{ animation: 'fadeInScale 0.6s ease-out 0.35s both' }}>
            <FeatureCard
              icon={<Code2 className="w-6 h-6" />}
              title={t('welcome.feature2')}
              description={t('welcome.feature2Desc')}
              accent="purple"
            />
          </div>
          <div style={{ animation: 'fadeInScale 0.6s ease-out 0.5s both' }}>
            <FeatureCard
              icon={<Users className="w-6 h-6" />}
              title={t('welcome.feature3')}
              description={t('welcome.feature3Desc')}
              accent="blue"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  accent: 'indigo' | 'purple' | 'blue';
}) {
  const accentStyles = {
    indigo: {
      bg: 'bg-indigo-100 dark:bg-indigo-900/40',
      text: 'text-indigo-600 dark:text-indigo-400',
      border: 'border-indigo-200/60 dark:border-indigo-700/30',
      glow: 'hover:shadow-indigo-200/40 dark:hover:shadow-indigo-900/30',
    },
    purple: {
      bg: 'bg-purple-100 dark:bg-purple-900/40',
      text: 'text-purple-600 dark:text-purple-400',
      border: 'border-purple-200/60 dark:border-purple-700/30',
      glow: 'hover:shadow-purple-200/40 dark:hover:shadow-purple-900/30',
    },
    blue: {
      bg: 'bg-blue-100 dark:bg-blue-900/40',
      text: 'text-blue-600 dark:text-blue-400',
      border: 'border-blue-200/60 dark:border-blue-700/30',
      glow: 'hover:shadow-blue-200/40 dark:hover:shadow-blue-900/30',
    },
  };

  const styles = accentStyles[accent];

  return (
    <div
      className={`p-6 rounded-xl bg-white/70 dark:bg-[#161b22]/70 backdrop-blur-md border ${styles.border}
        shadow-sm hover:shadow-lg ${styles.glow}
        hover:-translate-y-1 transition-all duration-300`}
    >
      <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg ${styles.bg} ${styles.text} mb-4`}>
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        {title}
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
        {description}
      </p>
    </div>
  );
}
