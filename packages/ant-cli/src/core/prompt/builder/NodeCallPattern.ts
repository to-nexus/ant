/**
 * Node LLM call pattern — determines prompt building strategy.
 *
 *   none     : No LLM call. State management, routing, tool execution.
 *              (resolve, tool, enforce, deliver, checkTaskStatus)
 *
 *   single   : Exactly one LLM call per node invocation.
 *              No turn accumulation — each call is independent.
 *              Parse failure → independent repair call (not turn continuation).
 *              Uses promptBuilder.render().
 *              (detect, revise, triage, keyword, learn decompose)
 *
 *   compound : Multiple LLM calls with turn accumulation.
 *              Turn 1 = initial blocks (system + context + task).
 *              Turn 2+ = initial blocks + accumulated prior turns.
 *              Requires CacheBlockMapper (cache/uncache block split)
 *              + MessageComposer (prior turn compression + budget).
 *              Uses promptBuilder.build() + CacheBlockMapper + MessageComposer.
 *              (execute, docGen, plan, ask, visual)
 */
export type NodeCallPattern = 'none' | 'single' | 'compound';
