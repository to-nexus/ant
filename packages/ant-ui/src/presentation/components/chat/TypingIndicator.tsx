/**
 * TypingIndicator - Subtle typing indicator for assistant response loading
 * 
 * Shows 3 dots with staggered pulse animation to indicate
 * the assistant is preparing a response (after submit, before first LLM token)
 */

export function TypingIndicator() {
  const dotStyle = {
    width: 8,
    height: 8,
    background: 'var(--violet-500)',
    animation: 'type-dot 1.2s ease-in-out infinite',
  } as const;
  return (
    <div className="flex items-center gap-1.5 px-3 py-3">
      <span className="rounded-full" style={{ ...dotStyle, animationDelay: '0ms' }} />
      <span className="rounded-full" style={{ ...dotStyle, animationDelay: '200ms' }} />
      <span className="rounded-full" style={{ ...dotStyle, animationDelay: '400ms' }} />
    </div>
  );
}
