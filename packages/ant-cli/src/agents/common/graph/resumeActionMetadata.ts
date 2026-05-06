import { resolveToRAC } from '@ant/shared';
import type { ActionMetadata, IntentId, ResolvedActionContext } from '@ant/shared';

type SlotSource = 'actionMetadata' | 'resolvedAction' | 'infer';

export interface ResumeActionSlots {
  target: string[];
  refs: string[];
  context: string[];
  sources: {
    target: SlotSource;
    refs: SlotSource;
    context: SlotSource;
  };
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/**
 * Resume metadata merge SSOT.
 *
 * Priority: actionMetadata -> resolvedAction -> inferTarget.
 * For each slot, `undefined` means "fallback allowed"; an explicit empty array
 * means "caller intentionally chose empty".
 */
export function resolveResumeActionSlots(params: {
  actionMetadata?: Pick<ActionMetadata, 'target' | 'refs' | 'context'>;
  resolvedAction?: Pick<ResolvedActionContext, 'target' | 'refs' | 'context'>;
  inferTarget?: string[];
}): ResumeActionSlots {
  const inferTarget = params.inferTarget ?? [];

  const target = isDefined(params.actionMetadata?.target)
    ? params.actionMetadata!.target
    : isDefined(params.resolvedAction?.target)
      ? params.resolvedAction!.target
      : inferTarget;
  const refs = isDefined(params.actionMetadata?.refs)
    ? params.actionMetadata!.refs
    : isDefined(params.resolvedAction?.refs)
      ? params.resolvedAction!.refs
      : [];
  const context = isDefined(params.actionMetadata?.context)
    ? params.actionMetadata!.context
    : isDefined(params.resolvedAction?.context)
      ? params.resolvedAction!.context
      : [];

  return {
    target: [...target],
    refs: [...refs],
    context: [...context],
    sources: {
      target: isDefined(params.actionMetadata?.target)
        ? 'actionMetadata'
        : isDefined(params.resolvedAction?.target)
          ? 'resolvedAction'
          : 'infer',
      refs: isDefined(params.actionMetadata?.refs)
        ? 'actionMetadata'
        : isDefined(params.resolvedAction?.refs)
          ? 'resolvedAction'
          : 'infer',
      context: isDefined(params.actionMetadata?.context)
        ? 'actionMetadata'
        : isDefined(params.resolvedAction?.context)
          ? 'resolvedAction'
          : 'infer',
    },
  };
}

/**
 * RAC restoration SSOT for resume/new-turn merge.
 *
 * - If actionMetadata carries an explicit intent, rebuild RAC from merged slots.
 * - Otherwise keep the existing RAC (typically restored from session).
 */
export function resolveResumedActionContext(params: {
  actionMetadata?: ActionMetadata;
  resolvedAction?: ResolvedActionContext;
  inferTarget?: string[];
}): ResolvedActionContext | undefined {
  const { actionMetadata, resolvedAction } = params;
  if (!actionMetadata?.intent) {
    return resolvedAction;
  }

  const slots = resolveResumeActionSlots({
    actionMetadata: {
      target: actionMetadata.target,
      refs: actionMetadata.refs,
      context: actionMetadata.context,
    },
    resolvedAction,
    inferTarget: params.inferTarget,
  });

  return resolveToRAC(
    actionMetadata.intent as IntentId,
    { target: slots.target, refs: slots.refs, context: slots.context },
    'explicit',
    resolvedAction?.basis,
  );
}
