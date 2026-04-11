/**
 * Document Injection Resolver
 *
 * Two independent axes:
 *   packages  → code scope  → system design injection
 *   task type → doc category → ui-doc injection
 *
 * task type × injection matrix:
 *   feature / setup / test-code / doc  → system design (packages-based)
 *   ui / design-system                 → ui-doc only (parsedUiDocs)
 *   error                              → nothing (selectedSpec override in promptBuilder)
 *   verification                       → nothing
 */

import { ArchitectGraphState } from '../state';
import { CodeTask } from '../../../types/task';
import { buildDesignDocForTask } from './designSelector';
import { ArtifactService } from '../../../../../infrastructure/workspace/ArtifactService';

/**
 * Resolve system design document for a task.
 *
 * Returns '' for visual tasks (ui/design-system) and diagnostic tasks (error/verification).
 * selectedSpec takes priority over packages for spec-driven jobs.
 */
export function resolveDesignDocForTask(task: CodeTask, state: ArchitectGraphState): string {
  // visual tasks: ui-doc is the source, system design irrelevant
  if (task.type === 'ui' || task.type === 'design-system') return '';

  // diagnostic tasks: no design context (error's selectedSpec handled post-call in promptBuilder)
  if (task.type === 'verification' || task.type === 'error') return '';

  // spec-driven jobs: selectedSpec takes priority over packages
  if (state.selectedSpec && state.specDocs?.[state.selectedSpec]) {
    const parts: string[] = [
      `# Feature Specification (Primary)\n\n${state.specDocs[state.selectedSpec]}`,
    ];
    if (state.designDocs?.apiContracts) {
      for (const [name, content] of Object.entries(state.designDocs.apiContracts)) {
        parts.push(`# API Contract: ${name} (Reference)\n\n${content}`);
      }
    }
    const result = parts.join('\n\n────────────────────────────────────────\n\n');
    console.log(`📋 [Resolver] Using spec doc "${state.selectedSpec}" as primary (${result.length} chars)`);
    return result;
  }

  // feature / setup / test-code / doc: system design via packages
  if (task.packages?.length && state.designDocs) {
    const result = buildDesignDocForTask(task.packages, state.designDocs);
    if (result) return result;
    // 'shared' packages have no fe-/be- design doc — fall through to full design
  }

  // fallback: packages yield no content, or packages/designDocs missing
  return state.design || '';
}

/**
 * Resolve UI document for a task.
 *
 * Returns undefined for all non-visual task types.
 * Returns undefined if parsedUiDocs is not loaded (ui-spec.json absent).
 */
export function resolveUiDocForTask(task: CodeTask, state: ArchitectGraphState): string | undefined {
  if (task.type !== 'ui' && task.type !== 'design-system') return undefined;
  if (!state.parsedUiDocs) return undefined;
  return ArtifactService.getUiDocForTask(state.parsedUiDocs, task.uiSections);
}
