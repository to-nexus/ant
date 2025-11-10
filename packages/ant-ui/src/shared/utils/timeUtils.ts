/**
 * Format milliseconds to human-readable time string
 * 
 * Examples:
 * - 1234 ms => "1s"
 * - 61234 ms => "1m 1s"
 * - 3661234 ms => "1h 1m 1s"
 * - 86461234 ms => "1d 1h 1m"
 * 
 * @param ms - Time in milliseconds
 * @param includeSeconds - Whether to include seconds (default: true)
 * @returns Formatted time string
 */
export function formatElapsedTime(ms: number, includeSeconds: boolean = true): string {
  if (!ms || ms < 0) return '0s';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  const parts: string[] = [];
  
  if (days > 0) {
    parts.push(`${days}d`);
  }
  
  if (hours > 0) {
    parts.push(`${hours % 24}h`);
  }
  
  if (minutes > 0) {
    parts.push(`${minutes % 60}m`);
  }
  
  if (includeSeconds && (seconds > 0 || parts.length === 0)) {
    parts.push(`${seconds % 60}s`);
  }
  
  // Limit to 3 most significant units
  return parts.slice(0, 3).join(' ');
}

