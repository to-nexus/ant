import { useStore } from '@/domain/store';

/**
 * Aggregates every "something is happening in the background" signal into
 * a single boolean. Consumers should treat the union as opaque — individual
 * domain badges (StatusChip, AgentJobToolbar) still render their own
 * specific state and are NOT replaced by this.
 *
 * Sources:
 *  - jobSlice.isRunning              — any job is currently executing
 *  - sseSlice.connectionStatus       — SSE is reconnecting
 *  - projectConfigSlice.refreshing   — re-fetch in progress with stale data shown
 */
export function useAmbientSources(): { active: boolean } {
  const isRunning = useStore((s) => s.isRunning);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const projectConfigRefreshing = useStore((s) => s.projectConfig.refreshing);

  return {
    active: isRunning || connectionStatus !== 'connected' || projectConfigRefreshing,
  };
}
