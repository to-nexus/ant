/**
 * Planner Agent
 * 
 * Handles PRD creation and refinement as a specialized planning agent.
 * Uses PRD-as-State pattern: the PRD file is the persistent state across jobs.
 * 
 * Graph: resolve → triage → generate (ReAct tool loop) → write
 */

export { runPlanGraph, type PlanRunnerParams, type PlanRunnerResult } from './graph/plan/runner';
