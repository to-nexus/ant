import type { CodeTask } from '../../../../../types/task';

/**
 * RC2 (RCA: bright-causing-brick re-run) — a renderable surface MUST sit in a
 * responsive, centered, max-width container. This is a STRUCTURAL validity floor
 * (sibling of the padding / no-flush floor), NOT visual treatment.
 *
 * It is deliberately INDEPENDENT of `visualTier` / `hasUiDoc`: the visualTier
 * suppressor drops all six visual-treatment layers when a UI design doc / handoff
 * source is present (the doc owns how it LOOKS). But a handoff overrides visual
 * treatment, not the structural requirement that content is contained / centered /
 * responsive — and a handoff silent on containment must not leave that floor
 * unowned (the admin shell came out flush-left because nothing imposed it). So this
 * floor fires on every renderable feature/ui surface regardless of UI-doc presence.
 *
 * Gate = renderable feature OR ui task. `renderable === true` already implies a
 * frontend surface; design-system (token infra) and non-renderable tasks are inert.
 */
export function layoutValidityFloorVars(task: CodeTask): { layoutValidityFloorActive: boolean } {
  const renderable = (task as { renderable?: boolean })?.renderable === true;
  const isSurface = task?.type === 'feature' || task?.type === 'ui';
  return { layoutValidityFloorActive: isSurface && renderable };
}
