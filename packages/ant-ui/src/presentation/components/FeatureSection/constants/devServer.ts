/**
 * Dev Server UI Constants
 */

export const DEV_SERVER_MESSAGES = {
  // Status Messages
  STATUS_INSTALLING: 'Installing dependencies...',
  STATUS_STARTING: 'Starting dev server...',
  STATUS_RUNNING: 'Preview server Running',
  STATUS_FAILED: 'Preview server Failed to Start',
  
  // Buttons
  BUTTON_OPEN: 'Open',
  
  // Errors
  ERROR_NO_PROJECT_FEATURE: 'Please select a project and feature first',
  ERROR_START_FAILED: 'Failed to start dev server',
  ERROR_STOP_FAILED: (message: string) => `Failed to stop dev server: ${message}`,
  ERROR_UNKNOWN: 'Unknown error occurred',
  
  // Log Messages
  LOG_STARTING: (feature: string) => `Starting dev server for feature: ${feature}`,
  LOG_STARTED: 'Preview server started successfully',
  LOG_STOPPED: 'Preview server stopped successfully',
  LOG_STATUS_CHECK_FAILED: 'Failed to check dev server status',
} as const;

export const DEV_SERVER_POLLING = {
  INTERVAL_MS: 5000,
  INITIAL_DELAY_MS: 1000,
} as const;

export const DEV_SERVER_LOG_PATTERNS = {
  INSTALLING: 'Installing dependencies',
  INSTALL_SUCCESS: 'Dependencies installed',
  INSTALL_FAILED: 'Failed to install dependencies',
  PORT_IN_USE: 'already in use',
  ERROR_MARKER: ['Error:', 'error:', '❌'],
} as const;

