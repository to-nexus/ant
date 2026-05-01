import { describe, it, expect, beforeAll } from 'vitest';
import { AgentRegistry } from '../../src/agents/common/graph/nodes/triage/AgentRegistry';

/**
 * Verifies that YAML job definitions stay in sync with the system.
 * 
 * - Every routable job type must have a YAML definition
 * - generateAskKnowledge() must include all YAML-defined jobs
 * - Every job mode must have an outputs field
 */

const ROUTABLE_JOB_TYPES = ['code', 'design', 'learn', 'plan', 'visual'] as const;

const NON_YAML_JOB_TYPES = ['ask', 'inline-ask'] as const;

describe('Ask Knowledge (YAML sync)', () => {
  beforeAll(async () => {
    await AgentRegistry.initialize();
  });

  it('every routable job type has a YAML definition', () => {
    const yamlJobIds = AgentRegistry.getJobIds();
    for (const jobType of ROUTABLE_JOB_TYPES) {
      expect(yamlJobIds, `Missing YAML definition for job type: ${jobType}`).toContain(jobType);
    }
  });

  it('generateAskKnowledge() includes all YAML-defined jobs', () => {
    const knowledge = AgentRegistry.generateAskKnowledge();
    const yamlJobIds = AgentRegistry.getJobIds();

    for (const jobId of yamlJobIds) {
      expect(knowledge, `generateAskKnowledge() missing job: ${jobId}`).toContain(`## ${jobId} Job`);
    }
  });

  it('generateAskKnowledge() includes all modes for each job', () => {
    const knowledge = AgentRegistry.generateAskKnowledge();
    const jobs = AgentRegistry.getAllJobs();

    for (const job of jobs) {
      for (const mode of job.modes) {
        expect(knowledge, `Missing mode ${mode.id} for job ${job.id}`).toContain(`### Mode: ${mode.id}`);
      }
    }
  });

  it('every non-explain job mode has outputs defined', () => {
    const jobs = AgentRegistry.getAllJobs();

    for (const job of jobs) {
      for (const mode of job.modes) {
        if (mode.id === 'explain') continue;
        expect(
          mode.outputs && mode.outputs.length > 0,
          `Job ${job.id} mode ${mode.id} is missing outputs`
        ).toBe(true);
      }
    }
  });

  it('generateAskKnowledge() includes Workflow Decision Principles', () => {
    const knowledge = AgentRegistry.generateAskKnowledge();
    expect(knowledge).toContain('## Workflow Decision Principles');
  });

  it('non-YAML job types are not in YAML definitions', () => {
    const yamlJobIds = AgentRegistry.getJobIds();
    for (const jobType of NON_YAML_JOB_TYPES) {
      expect(yamlJobIds, `${jobType} should not have YAML definition`).not.toContain(jobType);
    }
  });
});
