import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
// TEMP(action-system-compat): Compass/Code2 icons used only by hidden altDesign/altCode shortcuts; re-add when restoring.
import { Send, AlertCircle, Check, X, ArrowRight } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import { useStore } from '@/domain/store';
import { cn } from '@/shared/utils/design-system';
import { createProject, createFeature, addChatUserMessage } from '@/infrastructure/http/api';
import { executeCodeJob } from '@/infrastructure/http/cli';
import { isValidName, delay, generateProjectName, generateFeatureName } from '@/presentation/components/ProjectWizardModal/constants';
import { BrandHero } from '@/presentation/components/common/BrandHero';

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
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{
              background: 'var(--status-done-bg, oklch(70% 0.16 160))',
              color: 'var(--text-on-brand)',
            }}
          >
            <Check className="w-3 h-3" strokeWidth={3} style={{ color: 'var(--text-on-brand)' }} />
          </div>
        ) : status === 'active' ? (
          <Spinner size="lg" style={{ color: 'var(--violet-500)' }} />
        ) : (
          <div
            className="w-5 h-5 rounded-full"
            style={{ border: '2px solid var(--border-2)' }}
          />
        )}
      </div>
      <span
        className={`text-sm transition-colors duration-300 ${
          status === 'active' ? 'font-medium' : ''
        }`}
        style={{
          color:
            status === 'active'
              ? 'var(--violet-600)'
              : status === 'done'
                ? 'var(--text-2)'
                : 'var(--text-3)',
        }}
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
  const features = useStore((state) => state.features);
  const [projectName, setProjectName] = useState(() =>
    existingProjectId ?? generateProjectName(useStore.getState().projects),
  );
  const [featureName, setFeatureName] = useState(() =>
    generateFeatureName(useStore.getState().features.map((f) => f.name)),
  );

  const projectNameExists = !existingProjectId && !!projectName.trim() && projects.includes(projectName.trim());
  const featureNameExists = !!existingProjectId && !!featureName.trim() && features.some((f) => f.name === featureName.trim());
  const projectNameInvalid = !existingProjectId && !!projectName.trim() && !isValidName(projectName.trim());
  const featureNameInvalid = !!featureName.trim() && !isValidName(featureName.trim());
  const projectNameError = projectNameExists || projectNameInvalid;
  const featureNameError = featureNameExists || featureNameInvalid;
  const hasNameConflict = projectNameError || featureNameError;

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
      const projectId = projectName.trim();
      const feat = featureName.trim();
      if (!projectId || !feat) return;

      if (existingProjectId) {
        console.log(`[QuickStart] Using existing project: ${projectId}`);
      } else {
        setActiveStep('workspace');
        console.log(`[QuickStart] Creating project: ${projectId}`);
        await Promise.all([createProject(projectId), delay(1200)]);
      }

      // Step: feature
      setActiveStep('feature');
      console.log(`[QuickStart] Creating feature: ${feat}`);
      const language = useStore.getState().language;
      await Promise.all([createFeature(projectId, feat, language), delay(1000)]);

      useStore.getState().addFeatureOptimistic(feat);

      // Step: plan
      setActiveStep('plan');
      setSelectedAgent('planner');
      setSelectedJobType('plan');
      if (useStore.getState().selectedProject !== projectId) {
        setSelectedProject(projectId);
      }
      await delay(150);
      setSelectedFeature(feat);
      await delay(200);

      console.log(`[QuickStart] Starting plan job with directive: ${trimmed.substring(0, 50)}...`);
      setRunning(true, undefined, 'generate');
      
      await addChatUserMessage(projectId, feat, trimmed);
      
      const jobExecution = executeCodeJob({
        projectId,
        featureName: feat,
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

      // Ensure features are loaded in the store before transitioning.
      // setSelectedProject() fires fetchFeatures() as fire-and-forget, so
      // by this point it *may* have completed — but we cannot guarantee it.
      // An explicit await here ensures the store's features array is populated
      // before the explorer UI mounts (prevents the "no features" flash).
      await useStore.getState().fetchFeatures(projectId);

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
  }, [input, isSubmitting, userEmail, existingProjectId, projectName, featureName, fetchProjects, setSelectedProject, setSelectedFeature, setSelectedAgent, setSelectedJobType, setRunning, setCurrentJob, setQuickStartProjectId, t]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
    <div
      className={`min-h-screen pt-16 flex flex-col relative overflow-hidden
        transition-opacity duration-300 ${isExiting ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: 'var(--bg-app)' }}
    >
      {/* === Background layers === */}
      {/* Aurora mesh underlay (lowest z) */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'var(--gradient-mesh-bg)',
          opacity: 0.6,
          pointerEvents: 'none',
        }}
      />
      {/* Dot grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Floating orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute w-[450px] h-[450px] rounded-full blur-[90px] opacity-25"
          style={{
            background: 'radial-gradient(circle, var(--mesh-1) 0%, transparent 70%)',
            top: '20%',
            left: '10%',
            animation: 'qsOrbFloat1 22s ease-in-out infinite',
          }}
        />
        <div
          className="absolute w-[500px] h-[500px] rounded-full blur-[100px] opacity-25"
          style={{
            background: 'radial-gradient(circle, var(--mesh-2) 0%, transparent 70%)',
            top: '15%',
            right: '5%',
            animation: 'qsOrbFloat2 26s ease-in-out infinite',
          }}
        />
        <div
          className="absolute w-[350px] h-[350px] rounded-full blur-[70px] opacity-20"
          style={{
            background: 'radial-gradient(circle, var(--mesh-3) 0%, transparent 70%)',
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
        @keyframes glowSpin {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
      `}</style>

      {/* === Centered content === */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-6 pb-24 z-10">
        {/* Brand hero + Prompt text */}
        <div
          className="text-center mb-8"
          style={{ animation: 'qsFadeInUp 0.7s ease-out both' }}
        >
          <BrandHero logoSize={72} className="justify-center mb-6" />
          <h2
            className="text-3xl sm:text-4xl font-bold mb-3"
            style={{ color: 'var(--text-1)' }}
          >
            {t('quickstart.prompt')}
          </h2>
          <p
            className="text-base sm:text-lg"
            style={{ color: 'var(--text-2)' }}
          >
            {t('quickstart.promptSub')}
          </p>
        </div>

        {/* Glowing input container */}
        <div
          className="w-full max-w-2xl"
          style={{ animation: 'qsInputReveal 0.6s ease-out 0.15s both' }}
        >
          <div className="relative rounded-2xl p-[2px] overflow-hidden">
            {/* Animated glow border — spinning beam when empty, full glow when typing */}
            <div
              className={`absolute inset-0 transition-opacity duration-700 ${
                input.trim() ? 'opacity-0' : isSubmitting ? 'opacity-50' : 'opacity-100'
              }`}
            >
              {/* Spinning gradient beam — forced square to prevent distortion on wide rectangles */}
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  width: '200%',
                  aspectRatio: '1',
                  background: 'conic-gradient(from 0deg, oklch(60% 0.26 285), oklch(64% 0.28 340), oklch(72% 0.22 50), oklch(72% 0.18 195), oklch(64% 0.22 270), transparent 50%, transparent)',
                  animation: 'glowSpin 4s linear infinite',
                }}
              />
              {/* Subtle constant base glow — also forced square */}
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  width: '200%',
                  aspectRatio: '1',
                  transform: 'translate(-50%, -50%)',
                  background: 'conic-gradient(from 0deg, oklch(60% 0.26 285), oklch(64% 0.28 340), oklch(72% 0.22 50), oklch(72% 0.18 195), oklch(64% 0.22 270), oklch(60% 0.26 285))',
                  opacity: 0.12,
                }}
              />
            </div>

            {/* Typing state: full gradient glow */}
            <div
              className={`absolute inset-0 rounded-2xl transition-opacity duration-700 ${
                input.trim() ? (isSubmitting ? 'opacity-50' : 'opacity-100') : 'opacity-0'
              }`}
              style={{
                background: 'var(--gradient-aurora)',
              }}
            />

            {/* Outer glow halo */}
            <div
              className={`absolute inset-0 rounded-2xl blur-xl pointer-events-none transition-opacity duration-700 ${
                input.trim() ? 'opacity-50' : 'opacity-30'
              }`}
              style={{
                background: 'var(--gradient-aurora)',
              }}
            />

            {/* Inner card */}
            <div
              className="relative rounded-[14px] p-4"
              style={{ background: 'var(--bg-surface)', backdropFilter: 'blur(8px)' }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('quickstart.placeholder')}
                disabled={isSubmitting}
                rows={3}
                className="w-full bg-transparent text-base leading-relaxed resize-none outline-none
                         disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ color: 'var(--text-1)' }}
              />

              {/* Bottom bar: error + submit button */}
              <div className="flex items-center justify-between mt-2">
                <div className="flex-1">
                  {error && (
                    <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--red-500)' }}>
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{error}</span>
                      <button
                        onClick={() => {
                          setError(null);
                          handleSubmit();
                        }}
                        className="ml-1 underline underline-offset-2 transition-colors"
                        style={{ color: 'var(--red-500)' }}
                      >
                        {t('quickstart.errorRetry')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Submit button — Aurora aurora gradient CTA */}
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim() || isSubmitting || hasNameConflict || projectName.trim().length < 3 || featureName.trim().length < 3}
                  className="gradient-flow relative inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transform hover:scale-[1.02] active:scale-[0.98]
                           transition-all duration-200 overflow-hidden group"
                  style={{
                    background: 'var(--gradient-aurora)',
                    backgroundSize: '200% 200%',
                    boxShadow: 'var(--shadow-glow-aurora)',
                    animation: 'gradient-shift 5s ease-in-out infinite',
                    color: 'var(--text-on-brand)',
                    borderRadius: 12,
                  }}
                >
                  {/* Shine sweep on hover */}
                  <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                  <span className="relative flex items-center gap-2">
                    {isSubmitting ? (
                      <Spinner size="md" tone="inherit" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {t('quickstart.submit')}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Wizard shortcut cards */}
          {/* TEMP(action-system-compat): hide altDesign/altCode shortcut buttons until ProjectWizardModal is compatible.
          {!isSubmitting && (
            <div
              className="mt-4 flex gap-3"
              style={{ animation: 'qsFadeInUp 0.5s ease-out 0.3s both' }}
            >
              <button
                onClick={() => useStore.getState().setProjectSetupConfig({ mode: 'design', ...(existingProjectId ? { existingProjectId } : {}) })}
                className="flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl
                  border border-indigo-200/60
                  bg-white/60 backdrop-blur-sm
                  hover:bg-indigo-50/80
                  hover:border-indigo-300
                  transition-all duration-200 group"
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                  <Compass className="w-3.5 h-3.5 text-indigo-500" />
                </div>
                <span className="text-sm text-[color:var(--text-3)] group-hover:text-indigo-700 transition-colors">
                  {t('quickstart.altDesign')}
                </span>
                <ArrowRight className="w-3.5 h-3.5 ml-auto text-gray-300 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
              </button>
              <button
                onClick={() => useStore.getState().setProjectSetupConfig({ mode: 'code', ...(existingProjectId ? { existingProjectId } : {}) })}
                className="flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl
                  border border-amber-200/60
                  bg-white/60 backdrop-blur-sm
                  hover:bg-amber-50/80
                  hover:border-amber-300
                  transition-all duration-200 group"
              >
                <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                  <Code2 className="w-3.5 h-3.5 text-amber-500" />
                </div>
                <span className="text-sm text-[color:var(--text-3)] group-hover:text-amber-700 transition-colors">
                  {t('quickstart.altCode')}
                </span>
                <ArrowRight className="w-3.5 h-3.5 ml-auto text-gray-300 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
              </button>
            </div>
          )}
          */}

          {/* Progress step checklist */}
          {isSubmitting && activeStep !== 'idle' && (
            <div className="mt-6 flex justify-center">
              <div
                className="space-y-3 rounded-xl px-6 py-4"
                style={{
                  animation: 'qsFadeInUp 0.4s ease-out both',
                  background: 'var(--bg-surface)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid var(--border-2)',
                }}
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
                     text-sm rounded-xl shadow-sm hover:shadow-md
                     transition-all duration-200 hover:translate-x-0.5
                     group"
          style={{
            animation: 'qsFadeInUp 0.5s ease-out 0.5s both',
            color: 'var(--text-2)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-2)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span>{t('quickstart.skipToWorkspace')}</span>
          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      )}
    </div>

    {/* === Left-top project/feature name inputs === */}
    {/* Rendered outside overflow-hidden div to prevent focus border clipping */}
    {!isSubmitting && (
      <div
        className="fixed top-14 sm:top-16 left-3 sm:left-5 z-20 p-1"
        style={{ animation: 'qsFadeInUp 0.5s ease-out 0.1s both' }}
      >
        <div className="flex flex-col items-end sm:items-start sm:flex-row gap-1 sm:gap-4">
          {/* Project name */}
          <div className="flex items-start gap-1.5">
            <span
              className="text-[11px] font-medium whitespace-nowrap h-[30px] px-2.5 flex items-center justify-center rounded-full"
              style={{
                background: 'var(--gradient-violet-pink)',
                color: 'var(--text-on-brand)',
              }}
            >
              {t('quickstart.projectNameLabel')}
            </span>
            <div>
              <div className="relative">
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  disabled={!!existingProjectId}
                  readOnly={!!existingProjectId}
                  style={{
                    width: `${Math.max(9, Math.max(projectName.length, featureName.length) + 4)}ch`,
                    background: 'var(--bg-surface)',
                    color: 'var(--text-1)',
                    borderColor: projectNameError
                      ? 'var(--red-500)'
                      : 'var(--border-2)',
                    backdropFilter: 'blur(8px)',
                  }}
                  className={cn(
                    'min-w-36 px-2.5 py-1 pr-7 text-sm rounded-lg border-2',
                    'focus:outline-none',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    'transition-colors',
                  )}
                  placeholder="project-1"
                />
                {!existingProjectId && projectName.trim() && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2">
                    {projectNameError
                      ? <X className="w-3.5 h-3.5" style={{ color: 'var(--red-500)' }} />
                      : <Check className="w-3.5 h-3.5" style={{ color: 'var(--status-done-fg, oklch(60% 0.18 160))' }} />}
                  </span>
                )}
              </div>
              {projectNameExists && (
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--red-500)' }}>{t('quickstart.projectWizard.nameExists')}</p>
              )}
              {projectNameInvalid && (
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--red-500)' }}>{t('quickstart.projectWizard.nameInvalid')}</p>
              )}
            </div>
          </div>
          {/* Feature name */}
          <div className="flex items-start gap-1.5">
            <span
              className="text-[11px] font-medium whitespace-nowrap h-[30px] px-2.5 flex items-center justify-center rounded-full"
              style={{
                background: 'var(--gradient-cool)',
                color: 'var(--text-on-brand)',
              }}
            >
              {t('quickstart.featureNameLabel')}
            </span>
            <div>
              <div className="relative">
                <input
                  type="text"
                  value={featureName}
                  onChange={(e) => setFeatureName(e.target.value)}
                  style={{
                    width: `${Math.max(9, Math.max(projectName.length, featureName.length) + 4)}ch`,
                    background: 'var(--bg-surface)',
                    color: 'var(--text-1)',
                    borderColor: featureNameError
                      ? 'var(--red-500)'
                      : 'var(--border-2)',
                    backdropFilter: 'blur(8px)',
                  }}
                  className={cn(
                    'min-w-36 px-2.5 py-1 pr-7 text-sm rounded-lg border-2',
                    'focus:outline-none',
                    'transition-colors',
                  )}
                  placeholder="ant-1"
                />
                {featureName.trim() && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2">
                    {featureNameError
                      ? <X className="w-3.5 h-3.5" style={{ color: 'var(--red-500)' }} />
                      : <Check className="w-3.5 h-3.5" style={{ color: 'var(--status-done-fg, oklch(60% 0.18 160))' }} />}
                  </span>
                )}
              </div>
              {featureNameExists ? (
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--red-500)' }}>{t('quickstart.projectWizard.nameExists')}</p>
              ) : featureNameInvalid ? (
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--red-500)' }}>{t('quickstart.projectWizard.nameInvalid')}</p>
              ) : (
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {t('quickstart.gitBranchHint', { name: featureName || '...' })}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
