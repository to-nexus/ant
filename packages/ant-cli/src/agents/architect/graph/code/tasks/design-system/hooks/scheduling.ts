/**
 * design-system/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Design-system tasks do NOT have a type-level barrier in the current
 * orchestrator. Ordering between tokens (priority 100-199) → assets
 * (200-299) → spec (300+) is driven by priority-gated barriers
 * (`hasPreAssetsWork`, `hasPreSpecWork` in TaskOrchestrator) rather
 * than `task.type === 'design-system'` checks.
 *
 * This module exists for structural parity with other task bundles
 * so the registry entry is symmetric. No flags are set; priority-based
 * barriers continue to govern assignment in T6.
 */

export {};
