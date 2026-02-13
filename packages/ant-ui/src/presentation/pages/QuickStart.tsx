import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Loader2, AlertCircle, Check, ArrowRight } from 'lucide-react';
import { useStore } from '@/domain/store';
import { createProject, createFeature } from '@/infrastructure/http/api';
import { executeCodeJob } from '@/infrastructure/http/cli';

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract a safe workspace name from email.
 * john.doe@gmail.com → john-doe
 */
function extractNameFromEmail(email: string): string {
  const prefix = email.split('@')[0] || 'user';
  const sanitized = prefix
    .replace(/[._]/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return sanitized || 'user';
}

// ─── Ambient Canvas ─────────────────────────────────────────────────
// Renders soft floating particles that drift upward — subtle "energy" feel.
function AmbientCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = 0;
    let height = 0;

    interface Particle {
      x: number;
      y: number;
      r: number;
      alpha: number;
      dAlpha: number;
      vx: number;
      vy: number;
      hue: number;
    }
    let particles: Particle[] = [];

    function resize() {
      width = canvas!.clientWidth;
      height = canvas!.clientHeight;
      canvas!.width = width * devicePixelRatio;
      canvas!.height = height * devicePixelRatio;
      ctx!.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      initParticles();
    }

    function initParticles() {
      const count = Math.floor((width * height) / 12000);
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.8 + 0.5,
        alpha: Math.random() * 0.5 + 0.1,
        dAlpha: (Math.random() - 0.5) * 0.008,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -(Math.random() * 0.3 + 0.05), // drift upward
        hue: Math.random() < 0.5 ? 240 : 270, // indigo or purple tint
      }));
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha += p.dAlpha;

        if (p.alpha <= 0.05 || p.alpha >= 0.6) p.dAlpha *= -1;
        p.alpha = Math.max(0.05, Math.min(0.6, p.alpha));

        // Wrap around
        if (p.y < -10) { p.y = height + 10; p.x = Math.random() * width; }
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(${p.hue}, 60%, 75%, ${p.alpha})`;
        ctx!.fill();
      }

      animId = requestAnimationFrame(draw);
    }

    resize();
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
      style={{ opacity: 0.7 }}
    />
  );
}

// ─── Ordered steps for the progress checklist ───────────────────────
const STEP_KEYS_FULL = ['workspace', 'feature', 'plan', 'switching'] as const;
const STEP_KEYS_FEATURE_ONLY = ['feature', 'plan', 'switching'] as const;
type StepKey = 'workspace' | 'feature' | 'plan' | 'switching';

function getStepStatus(
  step: StepKey,
  activeStep: StepKey | 'idle',
  stepKeys: readonly StepKey[]
): 'pending' | 'active' | 'done' {
  if (activeStep === 'idle') return 'pending';
  const activeIdx = stepKeys.indexOf(activeStep as StepKey);
  const stepIdx = stepKeys.indexOf(step);
  if (stepIdx < activeIdx) return 'done';
  if (stepIdx === activeIdx) return 'active';
  return 'pending';
}

/** Single step row in the progress checklist */
function StepRow({
  label,
  status,
}: {
  label: string;
  status: 'pending' | 'active' | 'done';
}) {
  return (
    <div
      className={`flex items-center gap-3 transition-all duration-300 ${
        status === 'pending'
          ? 'opacity-40'
          : status === 'done'
            ? 'opacity-70'
            : 'opacity-100'
      }`}
    >
      <div className="shrink-0 w-5 h-5 flex items-center justify-center">
        {status === 'done' ? (
          <div className="w-5 h-5 rounded-full bg-emerald-500 dark:bg-emerald-400 flex items-center justify-center">
            <Check className="w-3 h-3 text-white dark:text-gray-900" strokeWidth={3} />
          </div>
        ) : status === 'active' ? (
          <Loader2 className="w-5 h-5 text-emerald-500 dark:text-emerald-400 animate-spin" />
        ) : (
          <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600" />
        )}
      </div>
      <span
        className={`text-sm transition-colors duration-300 ${
          status === 'active'
            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
            : status === 'done'
              ? 'text-gray-500 dark:text-gray-400'
              : 'text-gray-400 dark:text-gray-500'
        }`}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────
export interface QuickStartProps {
  existingProjectId?: string;  // If set, skip workspace creation and use this project
  onSkip?: () => void;
}

export function QuickStart({ existingProjectId, onSkip }: QuickStartProps) {
  const { t } = useTranslation('onboarding');
  const [input, setInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<StepKey | 'idle'>('idle');
  const [isExiting, setIsExiting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const userEmail = useStore((state) => state.userEmail);
  const projects = useStore((state) => state.projects);
  const setSelectedProject = useStore((state) => state.setSelectedProject);
  const setSelectedFeature = useStore((state) => state.setSelectedFeature);
  const setSelectedAgent = useStore((state) => state.setSelectedAgent);
  const setSelectedJobType = useStore((state) => state.setSelectedJobType);
  const fetchProjects = useStore((state) => state.fetchProjects);
  const setRunning = useStore((state) => state.setRunning);
  const setCurrentJob = useStore((state) => state.setCurrentJob);
  const setQuickStartProjectId = useStore((state) => state.setQuickStartProjectId);

  // Dynamic steps: skip workspace creation when using an existing project
  const stepKeys = existingProjectId ? STEP_KEYS_FEATURE_ONLY : STEP_KEYS_FULL;

  // Auto-focus the textarea
  useEffect(() => {
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isSubmitting || !userEmail) return;

    setIsSubmitting(true);
    setError(null);
    setIsExiting(false);

    try {
      let projectId: string;

      if (existingProjectId) {
        // ✅ Use existing project — skip workspace creation
        projectId = existingProjectId;
        console.log(`[QuickStart] Using existing project: ${projectId}`);
      } else {
        // ✅ Create new project
        const name = extractNameFromEmail(userEmail);
        projectId = `${name}-sketch`;

        if (projects.includes(projectId)) {
          let suffix = 1;
          while (projects.includes(`${projectId}-${suffix}`)) {
            suffix++;
          }
          projectId = `${projectId}-${suffix}`;
        }

        setActiveStep('workspace');
        console.log(`[QuickStart] Creating project: ${projectId}`);
        await Promise.all([createProject(projectId), delay(1200)]);
      }

      const featureName = 'skeleton';

      // Step: feature
      setActiveStep('feature');
      console.log(`[QuickStart] Creating feature: ${featureName}`);
      await Promise.all([createFeature(projectId, featureName), delay(1000)]);

      // Step: plan
      setActiveStep('plan');
      setSelectedAgent('planner');
      setSelectedJobType('plan');
      setSelectedProject(projectId);
      await delay(150);
      setSelectedFeature(featureName);
      await delay(200);

      console.log(`[QuickStart] Starting plan job with directive: ${trimmed.substring(0, 50)}...`);
      setRunning(true, undefined, 'generate');
      const jobExecution = executeCodeJob({
        projectId,
        featureName,
        jobType: 'plan',
        agent: 'planner',
        overrideDirective: trimmed,
        chatSource: true,
      });
      setCurrentJob(jobExecution);
      jobExecution.onJobIdReady((jobId) => {
        console.log(`[QuickStart] Job started: ${jobId}`);
        setRunning(true, jobId);
      });
      jobExecution.on('exit', (code) => {
        console.log(`[QuickStart] Job finished: ${code}`);
        useStore.getState().setLastJobFailed(code !== 0 && code !== null);
        setRunning(false);
        setCurrentJob(null);
      });
      await delay(1000);

      // Step: switching
      setActiveStep('switching');
      await delay(800);

      // Fade out before switching to the normal UI
      setIsExiting(true);
      await delay(400);

      // Clear quickStartProjectId so App transitions away from QuickStart
      setQuickStartProjectId(undefined);

      // Now allow App to transition away from QuickStart
      await fetchProjects();
    } catch (err) {
      console.error('[QuickStart] Error:', err);
      setError(err instanceof Error ? err.message : t('quickstart.error'));
      setIsSubmitting(false);
      setActiveStep('idle');
    }
  }, [input, isSubmitting, userEmail, existingProjectId, projects, fetchProjects, setSelectedProject, setSelectedFeature, setSelectedAgent, setSelectedJobType, setRunning, setCurrentJob, setQuickStartProjectId, t]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className={`min-h-screen bg-gradient-to-br from-gray-50 via-white to-indigo-50/30 dark:from-[#0d1117] dark:via-[#0d1117] dark:to-[#110d20] pt-16 flex flex-col relative overflow-hidden
        transition-opacity duration-300 ${isExiting ? 'opacity-0' : 'opacity-100'}`}
    >
      {/* === Background layers === */}
      {/* Dot grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03] dark:opacity-[0.05]"
        style={{
          backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Floating orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute w-[450px] h-[450px] rounded-full blur-[90px] opacity-20 dark:opacity-15"
          style={{
            background: 'radial-gradient(circle, rgba(99,102,241,0.5) 0%, transparent 70%)',
            top: '20%',
            left: '10%',
            animation: 'qsOrbFloat1 22s ease-in-out infinite',
          }}
        />
        <div
          className="absolute w-[500px] h-[500px] rounded-full blur-[100px] opacity-20 dark:opacity-12"
          style={{
            background: 'radial-gradient(circle, rgba(168,85,247,0.4) 0%, transparent 70%)',
            top: '15%',
            right: '5%',
            animation: 'qsOrbFloat2 26s ease-in-out infinite',
          }}
        />
        <div
          className="absolute w-[350px] h-[350px] rounded-full blur-[70px] opacity-15 dark:opacity-10"
          style={{
            background: 'radial-gradient(circle, rgba(20,184,166,0.4) 0%, transparent 70%)',
            bottom: '20%',
            right: '25%',
            animation: 'qsOrbFloat3 19s ease-in-out infinite',
          }}
        />
      </div>

      {/* Particle canvas */}
      <div className="absolute inset-0 pt-16">
        <AmbientCanvas />
      </div>

      {/* === Inline keyframes === */}
      <style>{`
        @keyframes qsOrbFloat1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -20px) scale(1.06); }
          66% { transform: translate(-15px, 15px) scale(0.94); }
        }
        @keyframes qsOrbFloat2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-40px, 25px) scale(1.07); }
          66% { transform: translate(25px, -35px) scale(0.93); }
        }
        @keyframes qsOrbFloat3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(25px, -20px) scale(1.08); }
        }
        @keyframes qsFadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes qsInputReveal {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* === Centered content === */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-6 pb-24 z-10">
        {/* Prompt text */}
        <div
          className="text-center mb-8"
          style={{ animation: 'qsFadeInUp 0.7s ease-out both' }}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-3">
            {t('quickstart.prompt')}
          </h2>
          <p className="text-base sm:text-lg text-gray-500 dark:text-gray-400">
            {t('quickstart.promptSub')}
          </p>
        </div>

        {/* Glowing input container */}
        <div
          className="w-full max-w-2xl"
          style={{ animation: 'qsInputReveal 0.6s ease-out 0.15s both' }}
        >
          <div className="relative rounded-2xl p-[2px] overflow-hidden">
            {/* Animated glow border — spins when empty, expands to full glow when typing */}
            <div
              className={`absolute transition-all duration-700 ease-in-out ${
                input.trim()
                  ? 'inset-0 rounded-2xl'         /* full coverage, no spin */
                  : 'inset-[-50%] animate-glow-spin' /* spinning conic sweep */
              } ${isSubmitting ? 'opacity-50' : 'opacity-100'}`}
              style={{
                background: input.trim()
                  ? 'linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7, #10b981, #14b8a6)'
                  : 'conic-gradient(from 0deg, #6366f1, #8b5cf6, #a855f7, #10b981, #14b8a6, #6366f1)',
              }}
            />

            {/* Outer glow halo — intensifies when typing */}
            <div
              className={`absolute inset-0 rounded-2xl blur-xl pointer-events-none transition-opacity duration-700 ${
                input.trim()
                  ? 'opacity-50 dark:opacity-40'
                  : 'opacity-40 dark:opacity-30'
              }`}
              style={{
                background: input.trim()
                  ? 'linear-gradient(135deg, rgba(99,102,241,0.4), rgba(139,92,246,0.4), rgba(16,185,129,0.4))'
                  : 'conic-gradient(from 0deg, rgba(99,102,241,0.3), rgba(139,92,246,0.3), rgba(16,185,129,0.3), rgba(99,102,241,0.3))',
                animation: input.trim() ? 'none' : 'glow-spin 3s linear infinite',
              }}
            />

            {/* Inner card */}
            <div className="relative rounded-[14px] bg-white/90 dark:bg-[#161b22]/90 backdrop-blur-sm p-4">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('quickstart.placeholder')}
                disabled={isSubmitting}
                rows={3}
                className="w-full bg-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500
                         text-base leading-relaxed resize-none outline-none
                         disabled:opacity-50 disabled:cursor-not-allowed"
              />

              {/* Bottom bar: error + submit button */}
              <div className="flex items-center justify-between mt-2">
                <div className="flex-1">
                  {error && (
                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{error}</span>
                      <button
                        onClick={() => {
                          setError(null);
                          handleSubmit();
                        }}
                        className="ml-1 underline underline-offset-2 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                      >
                        {t('quickstart.errorRetry')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Submit button */}
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim() || isSubmitting}
                  className="relative inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white
                           bg-gradient-to-r from-emerald-500 to-teal-600
                           hover:from-emerald-600 hover:to-teal-700
                           dark:from-emerald-400 dark:to-teal-500
                           dark:hover:from-emerald-500 dark:hover:to-teal-600
                           rounded-xl shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/30
                           disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-md
                           transform hover:scale-[1.02] active:scale-[0.98]
                           transition-all duration-200 overflow-hidden group"
                >
                  {/* Shine sweep on hover */}
                  <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                  <span className="relative flex items-center gap-2">
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {t('quickstart.submit')}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Progress step checklist */}
          {isSubmitting && activeStep !== 'idle' && (
            <div className="mt-6 flex justify-center">
              <div
                className="space-y-3 bg-white/60 dark:bg-white/5 backdrop-blur-md rounded-xl px-6 py-4 border border-gray-200/50 dark:border-gray-700/30"
                style={{ animation: 'qsFadeInUp 0.4s ease-out both' }}
              >
                {stepKeys.map((step) => (
                  <StepRow
                    key={step}
                    label={t(`quickstart.steps.${step}`)}
                    status={getStepStatus(step, activeStep, stepKeys)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Skip button — bottom-right corner */}
      {onSkip && !isSubmitting && (
        <button
          onClick={onSkip}
          className="fixed bottom-6 right-6 z-20 flex items-center gap-2 px-4 py-2.5
                     text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300
                     bg-white/70 dark:bg-white/5 backdrop-blur-sm
                     border border-gray-200 dark:border-gray-700 rounded-xl
                     shadow-sm hover:shadow-md
                     transition-all duration-200 hover:translate-x-0.5
                     group"
          style={{ animation: 'qsFadeInUp 0.5s ease-out 0.5s both' }}
        >
          <span>{t('quickstart.skipToWorkspace')}</span>
          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      )}
    </div>
  );
}
