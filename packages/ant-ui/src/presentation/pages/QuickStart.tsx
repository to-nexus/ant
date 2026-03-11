import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Loader2, AlertCircle, Check, X, ArrowRight, Compass, Code2 } from 'lucide-react';
import { useStore } from '@/domain/store';
import { cn } from '@/shared/utils/design-system';
import { createProject, createFeature, addChatUserMessage } from '@/infrastructure/http/api';
import { executeCodeJob } from '@/infrastructure/http/cli';
import { isValidName, delay, generateProjectName, generateFeatureName } from '@/presentation/components/ProjectWizardModal/constants';

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
        @keyframes glowSpin {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg); }
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
                  background: 'conic-gradient(from 0deg, #6366f1, #8b5cf6, #a855f7, #10b981, #14b8a6, transparent 50%, transparent)',
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
                  background: 'conic-gradient(from 0deg, #6366f1, #8b5cf6, #a855f7, #10b981, #14b8a6, #6366f1)',
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
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7, #10b981, #14b8a6)',
              }}
            />

            {/* Outer glow halo */}
            <div
              className={`absolute inset-0 rounded-2xl blur-xl pointer-events-none transition-opacity duration-700 ${
                input.trim() ? 'opacity-50 dark:opacity-40' : 'opacity-30'
              }`}
              style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.4), rgba(139,92,246,0.4), rgba(16,185,129,0.4))',
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
                  disabled={!input.trim() || isSubmitting || hasNameConflict || projectName.trim().length < 3 || featureName.trim().length < 3}
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

          {/* Wizard shortcut cards */}
          {!isSubmitting && (
            <div
              className="mt-4 flex gap-3"
              style={{ animation: 'qsFadeInUp 0.5s ease-out 0.3s both' }}
            >
              <button
                onClick={() => useStore.getState().setProjectSetupConfig({ mode: 'design', ...(existingProjectId ? { existingProjectId } : {}) })}
                className="flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl
                  border border-indigo-200/60 dark:border-indigo-800/40
                  bg-white/60 dark:bg-white/5 backdrop-blur-sm
                  hover:bg-indigo-50/80 dark:hover:bg-indigo-950/20
                  hover:border-indigo-300 dark:hover:border-indigo-700
                  transition-all duration-200 group"
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                  <Compass className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                </div>
                <span className="text-sm text-gray-600 dark:text-gray-400 group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition-colors">
                  {t('quickstart.altDesign')}
                </span>
                <ArrowRight className="w-3.5 h-3.5 ml-auto text-gray-300 dark:text-gray-600 group-hover:text-indigo-400 dark:group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
              </button>
              <button
                onClick={() => useStore.getState().setProjectSetupConfig({ mode: 'code', ...(existingProjectId ? { existingProjectId } : {}) })}
                className="flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl
                  border border-amber-200/60 dark:border-amber-800/40
                  bg-white/60 dark:bg-white/5 backdrop-blur-sm
                  hover:bg-amber-50/80 dark:hover:bg-amber-950/20
                  hover:border-amber-300 dark:hover:border-amber-700
                  transition-all duration-200 group"
              >
                <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                  <Code2 className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                </div>
                <span className="text-sm text-gray-600 dark:text-gray-400 group-hover:text-amber-700 dark:group-hover:text-amber-300 transition-colors">
                  {t('quickstart.altCode')}
                </span>
                <ArrowRight className="w-3.5 h-3.5 ml-auto text-gray-300 dark:text-gray-600 group-hover:text-amber-400 dark:group-hover:text-amber-500 group-hover:translate-x-0.5 transition-all" />
              </button>
            </div>
          )}

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
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap h-[30px] px-2.5 flex items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/40">
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
                  style={{ width: `${Math.max(9, Math.max(projectName.length, featureName.length) + 4)}ch` }}
                  className={cn(
                    'min-w-36 px-2.5 py-1 pr-7 text-sm rounded-lg border-2',
                    'bg-white/80 dark:bg-white/5 backdrop-blur-sm',
                    'text-gray-900 dark:text-white',
                    'placeholder-gray-400 dark:placeholder-gray-500',
                    'focus:outline-none',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    'transition-colors',
                    existingProjectId && 'bg-gray-50 dark:bg-gray-800/50 cursor-not-allowed',
                    projectNameError
                      ? 'border-red-300 dark:border-red-700 focus:border-red-500'
                      : 'border-gray-200 dark:border-gray-700 focus:border-emerald-500',
                  )}
                  placeholder="project-1"
                />
                {!existingProjectId && projectName.trim() && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2">
                    {projectNameError
                      ? <X className="w-3.5 h-3.5 text-red-500" />
                      : <Check className="w-3.5 h-3.5 text-emerald-500" />}
                  </span>
                )}
              </div>
              {projectNameExists && (
                <p className="mt-0.5 text-[11px] text-red-500 dark:text-red-400">{t('quickstart.projectWizard.nameExists')}</p>
              )}
              {projectNameInvalid && (
                <p className="mt-0.5 text-[11px] text-red-500 dark:text-red-400">{t('quickstart.projectWizard.nameInvalid')}</p>
              )}
            </div>
          </div>
          {/* Feature name */}
          <div className="flex items-start gap-1.5">
            <span className="text-[11px] font-medium text-sky-600 dark:text-sky-400 whitespace-nowrap h-[30px] px-2.5 flex items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/40 border border-sky-200/60 dark:border-sky-800/40">
              {t('quickstart.featureNameLabel')}
            </span>
            <div>
              <div className="relative">
                <input
                  type="text"
                  value={featureName}
                  onChange={(e) => setFeatureName(e.target.value)}
                  style={{ width: `${Math.max(9, Math.max(projectName.length, featureName.length) + 4)}ch` }}
                  className={cn(
                    'min-w-36 px-2.5 py-1 pr-7 text-sm rounded-lg border-2',
                    'bg-white/80 dark:bg-white/5 backdrop-blur-sm',
                    'text-gray-900 dark:text-white',
                    'placeholder-gray-400 dark:placeholder-gray-500',
                    'focus:outline-none',
                    'transition-colors',
                    featureNameError
                      ? 'border-red-300 dark:border-red-700 focus:border-red-500'
                      : 'border-gray-200 dark:border-gray-700 focus:border-emerald-500',
                  )}
                  placeholder="ant-1"
                />
                {featureName.trim() && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2">
                    {featureNameError
                      ? <X className="w-3.5 h-3.5 text-red-500" />
                      : <Check className="w-3.5 h-3.5 text-emerald-500" />}
                  </span>
                )}
              </div>
              {featureNameExists ? (
                <p className="mt-0.5 text-[11px] text-red-500 dark:text-red-400">{t('quickstart.projectWizard.nameExists')}</p>
              ) : featureNameInvalid ? (
                <p className="mt-0.5 text-[11px] text-red-500 dark:text-red-400">{t('quickstart.projectWizard.nameInvalid')}</p>
              ) : (
                <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
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
