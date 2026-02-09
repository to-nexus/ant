/**
 * Dismissed Messages Persistence
 * 
 * Stores dismissed preview server messages in localStorage
 * User can dismiss error messages with X button
 * Messages stay dismissed until user explicitly clicks Play button again
 */

import type { DismissedMessage, SetupFailureReasoning } from '../types/preview';

const STORAGE_KEY = 'ant-ui:dismissed-preview-messages';

/**
 * Load all dismissed messages from localStorage
 */
export function loadDismissedMessages(): DismissedMessage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const messages: DismissedMessage[] = JSON.parse(stored);
    return messages;
  } catch (error) {
    return [];
  }
}

/**
 * Save a dismissed message to localStorage
 */
export function saveDismissedMessage(
  serverKey: string,
  reasoning: SetupFailureReasoning
): void {
  try {
    const existing = loadDismissedMessages();
    
    // Check if already dismissed
    const isDuplicate = existing.some(
      msg => msg.serverKey === serverKey && msg.reasoning === reasoning
    );
    
    if (isDuplicate) return;
    
    const newMessage: DismissedMessage = {
      serverKey,
      reasoning,
      dismissedAt: Date.now()
    };
    
    const updated = [...existing, newMessage];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    // Silent fail
  }
}

/**
 * Clear dismissed messages for a specific server
 * Called when user clicks Play button (explicit retry)
 */
export function clearDismissedMessagesForServer(serverKey: string): void {
  try {
    const existing = loadDismissedMessages();
    const filtered = existing.filter(msg => msg.serverKey !== serverKey);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    // Silent fail
  }
}

/**
 * Clear all dismissed messages
 */
export function clearDismissedMessages(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // Silent fail
  }
}

/**
 * Check if a specific message is dismissed
 */
export function isMessageDismissed(
  serverKey: string,
  reasoning: SetupFailureReasoning
): boolean {
  const dismissed = loadDismissedMessages();
  return dismissed.some(
    msg => msg.serverKey === serverKey && msg.reasoning === reasoning
  );
}

