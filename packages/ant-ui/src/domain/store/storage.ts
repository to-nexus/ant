// LocalStorage and SessionStorage keys
export const STORAGE_KEYS = {
  RUNNING_TASK: 'ant-ui:running-task',
  TASK_START_TIME: 'ant-ui:task-start-time',
  TASK_MODE: 'ant-ui:task-mode',
  SELECTED_PROJECT: 'ant-ui:selected-project',  // ✅ sessionStorage
  PROJECT_LAST_FEATURES: 'ant-ui:project-last-features',  // ✅ Map of project → last feature (sessionStorage)
  SELECTED_AGENT: 'ant-ui:selected-agent',
  SELECTED_JOB_TYPE: 'ant-ui:selected-job-type',
  THEME: 'ant-ui:theme',
  MAIN_VIEW: 'ant-ui:main-view',
  USER_EMAIL: 'ant-ui:user-email',
  USER_ORGANIZATION: 'ant-ui:user-organization',
  LOCAL_BACKEND_PORT: 'ant-ui:local-backend-port',  // 로컬 백엔드 포트 (default: 4100)
  DISMISSED_INTERRUPT_TIMESTAMP: 'ant-ui:dismissed-interrupt-timestamp',
  LANGUAGE: 'ant-ui:language',
} as const;

// Default values
export const DEFAULT_LOCAL_BACKEND_PORT = 4100;

// ✅ Keys that should use sessionStorage (tab-specific)
const SESSION_STORAGE_KEYS = new Set<string>([
  STORAGE_KEYS.SELECTED_PROJECT,
  STORAGE_KEYS.PROJECT_LAST_FEATURES,
  STORAGE_KEYS.SELECTED_AGENT,
  STORAGE_KEYS.SELECTED_JOB_TYPE,
]);

// Helper functions for storage (localStorage or sessionStorage based on key)
export const saveToStorage = (key: string, value: any) => {
  try {
    // NOTE:
    // Some embedded webviews / hard reload flows can behave inconsistently with sessionStorage.
    // To make refresh resilient, we store "session keys" in BOTH sessionStorage and localStorage,
    // and prefer sessionStorage on read (falling back to localStorage).
    const isSessionKey = SESSION_STORAGE_KEYS.has(key as any);
    const serialized = JSON.stringify(value);
    if (isSessionKey) {
      sessionStorage.setItem(key, serialized);
      localStorage.setItem(key, serialized);
    } else {
      localStorage.setItem(key, serialized);
    }
  } catch (error) {
    console.error('Failed to save to storage:', error);
  }
};

export const loadFromStorage = (key: string): any => {
  try {
    const isSessionKey = SESSION_STORAGE_KEYS.has(key as any);
    const primary = isSessionKey ? sessionStorage.getItem(key) : localStorage.getItem(key);
    if (primary) return JSON.parse(primary);

    // Fallback: session keys also live in localStorage as a backup for refresh resiliency
    if (isSessionKey) {
      const backup = localStorage.getItem(key);
      return backup ? JSON.parse(backup) : null;
    }

    return null;
  } catch (error) {
    console.error('Failed to load from storage:', error);
    return null;
  }
};

export const removeFromStorage = (key: string) => {
  try {
    const isSessionKey = SESSION_STORAGE_KEYS.has(key as any);
    if (isSessionKey) {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    } else {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.error('Failed to remove from storage:', error);
  }
};

