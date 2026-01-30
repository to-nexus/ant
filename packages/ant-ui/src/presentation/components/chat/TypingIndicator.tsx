/**
 * TypingIndicator - Subtle typing indicator for assistant response loading
 * 
 * Shows 3 dots with staggered pulse animation to indicate
 * the assistant is preparing a response (after submit, before first LLM token)
 */

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-3 py-3">
      {/* Three dots with staggered animation delay */}
      <span 
        className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-typing-dot"
        style={{ animationDelay: '0ms' }}
      />
      <span 
        className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-typing-dot"
        style={{ animationDelay: '200ms' }}
      />
      <span 
        className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 animate-typing-dot"
        style={{ animationDelay: '400ms' }}
      />
    </div>
  );
}
