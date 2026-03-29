/**
 * Preview Server UI Constants
 */

export const PREVIEW_MESSAGES = {
  // Status Messages
  STATUS_INSTALLING: 'Installing dependencies...',
  STATUS_STARTING: 'Starting preview...',
  STATUS_RUNNING: 'Preview is Running',
  STATUS_FAILED: 'Preview is not Running',
  
  // Buttons
  BUTTON_OPEN: 'Open',
  
  // Errors
  ERROR_NO_PROJECT_FEATURE: 'Please select a workspace and feature first',
  ERROR_START_FAILED: 'Failed to start preview',
  ERROR_STOP_FAILED: (message: string) => `Failed to stop preview: ${message}`,
  ERROR_UNKNOWN: 'Unknown error occurred',
  
  // Log Messages
  LOG_STARTING: (feature: string) => `Starting preview for feature: ${feature}`,
  LOG_STARTED: 'Preview started successfully',
  LOG_STOPPED: 'Preview stopped successfully',
  LOG_STATUS_CHECK_FAILED: 'Failed to check preview status',
} as const;

export const PREVIEW_LOG_PATTERNS = {
  INSTALLING: 'Installing dependencies',
  INSTALL_SUCCESS: 'Dependencies installed',
  INSTALL_FAILED: 'Failed to install dependencies',
  PORT_IN_USE: 'already in use',
  ERROR_MARKER: ['Error:', 'error:', '❌'],
} as const;
