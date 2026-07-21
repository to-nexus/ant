/**
 * Auxiliary (non-job) LLM metering — the shared seam every one-shot LLM call
 * made OUTSIDE a job/graph funnels through to be billed.
 *
 * The normal billing pipeline is `jobId`-keyed (reserve → debitToCumulative →
 * settle, driven by graph state + the Redis task-queue snapshot). A one-shot
 * call from an HTTP route (e.g. the ant-authored commit message) has no jobId,
 * no graph state, and no KanbanBroadcaster, so it can never enter that path.
 * This helper closes that gap: it captures usage from `invokeWithUsage`, prices
 * it via the `@ant/shared` pricing SSOT, and records it through the ledger's
 * `debitAuxiliary` one-shot debit.
 *
 * Injection discipline mirrors `core/context/breadcrumbSummary.ts`: the `llm`
 * and `ledger` are passed IN by the caller (a periphery/infrastructure seam
 * that owns those handles) — core never reaches into infrastructure.
 *
 * Best-effort: any metering failure is swallowed so a billing hiccup never
 * blocks the underlying action (the commit still lands).
 */

import { computeModelCostBreakdownUsd, costOfTaskUsage } from '@ant/shared';
import type { CreditLedgerPort } from '../ports/creditLedger';
import type { LLMClient } from '../ports/llm';

export interface AuxiliaryBillingContext {
  orgId: string;
  userId: string;
  projectId?: string;
  /** Dedupes a retried aux debit. Generated if omitted. */
  idempotencyKey?: string;
}

export interface InvokeAndMeterAuxiliaryInput {
  llm: LLMClient;
  messages: Array<{ role: string; content: string }>;
  options?: Record<string, unknown>;
  /** Auxiliary call kind — labels the `'auxiliary'` ledger row (e.g. `commit`). */
  kind: string;
  /** When present (cloud), usage is priced and debited. Omit to skip billing. */
  billing?: AuxiliaryBillingContext;
  ledger?: CreditLedgerPort;
}

function randomKey(kind: string): string {
  // crypto.randomUUID is available in the Node runtime; fall back defensively.
  const uuid =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `${kind}:${uuid}`;
}

/**
 * Invoke the LLM once, capture usage, and (when a billing context + ledger are
 * supplied) debit the auxiliary cost. Returns the model's text content.
 *
 * Uses `invokeWithUsage` so the usage is not discarded (plain `invoke` throws
 * it away). If the client does not implement `invokeWithUsage`, it falls back
 * to `invoke` and skips metering (usage unavailable).
 */
export async function invokeAndMeterAuxiliary(
  input: InvokeAndMeterAuxiliaryInput,
): Promise<string> {
  const { llm, messages, options, kind, billing, ledger } = input;

  if (typeof llm.invokeWithUsage !== 'function') {
    return llm.invoke(messages, options);
  }

  const { content, usage } = await llm.invokeWithUsage(messages, options);

  if (usage && billing && ledger && typeof ledger.debitAuxiliary === 'function') {
    try {
      const modelId = llm.modelName;
      const usdCost = costOfTaskUsage(modelId, usage);
      const modelBreakdown = computeModelCostBreakdownUsd({ [modelId]: usage });
      await ledger.debitAuxiliary({
        orgId: billing.orgId,
        userId: billing.userId,
        usdCost,
        modelBreakdown,
        kind,
        idempotencyKey: billing.idempotencyKey ?? randomKey(kind),
        ...(billing.projectId && { projectId: billing.projectId }),
      });
    } catch (err) {
      console.warn(`⚠️  [AuxBilling] debitAuxiliary failed (kind=${kind}):`, err);
    }
  }

  return content;
}
