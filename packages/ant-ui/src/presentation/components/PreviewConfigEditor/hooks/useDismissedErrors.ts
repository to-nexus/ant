import { useState, useEffect, useCallback } from 'react';

export function useDismissedErrors(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
) {
  const dismissedKey = `ant-ui:dismissed-preview-errors:${selectedProject || ''}:${selectedFeature || 'main'}`;
  const [dismissedSet, setDismissedSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const stored = localStorage.getItem(dismissedKey);
      setDismissedSet(stored ? new Set(JSON.parse(stored)) : new Set());
    } catch { setDismissedSet(new Set()); }
  }, [dismissedKey]);

  const dismissError = useCallback((key: string) => {
    setDismissedSet(prev => {
      const next = new Set(prev);
      next.add(key);
      try { localStorage.setItem(dismissedKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [dismissedKey]);

  const clearDismissed = useCallback(() => {
    setDismissedSet(new Set());
    try { localStorage.removeItem(dismissedKey); } catch {}
  }, [dismissedKey]);

  return { dismissedSet, dismissError, clearDismissed };
}
