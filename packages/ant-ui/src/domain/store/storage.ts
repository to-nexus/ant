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
  BACKEND_MODE: 'ant-ui:backend-mode',
  DISMISSED_INTERRUPT_TIMESTAMP: 'ant-ui:dismissed-interrupt-timestamp',
} as const;

// ✅ Keys that should use sessionStorage (tab-specific)
const SESSION_STORAGE_KEYS = new Set<string>([
  STORAGE_KEYS.SELECTED_PROJECT,
  STORAGE_KEYS.PROJECT_LAST_FEATURES,
]);

// Helper functions for storage (localStorage or sessionStorage based on key)
export const saveToStorage = (key: string, value: any) => {
  try {
    const storage = SESSION_STORAGE_KEYS.has(key as any) ? sessionStorage : localStorage;
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('Failed to save to storage:', error);
  }
};

export const loadFromStorage = (key: string): any => {
  try {
    const storage = SESSION_STORAGE_KEYS.has(key as any) ? sessionStorage : localStorage;
    const item = storage.getItem(key);
    return item ? JSON.parse(item) : null;
  } catch (error) {
    console.error('Failed to load from storage:', error);
    return null;
  }
};

export const removeFromStorage = (key: string) => {
  try {
    const storage = SESSION_STORAGE_KEYS.has(key as any) ? sessionStorage : localStorage;
    storage.removeItem(key);
  } catch (error) {
    console.error('Failed to remove from storage:', error);
  }
};

