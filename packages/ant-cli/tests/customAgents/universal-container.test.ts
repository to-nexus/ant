/**
 * Universal container axis — feature-slot resolution, the bidirectional
 * project-type × jobType gate, container bootstrap, and the per-(agentId,
 * jobId) session path shape. Fixtures live under os.tmpdir() per test.
 *
 * Tombstones (valid in the thread-removal commit): the thread plane
 * (`threadPaths.ts`, `ANT_THREAD_ID`) is fully deleted — universal projects
 * have exactly one chat container at `{project}/universal`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UNIVERSAL_FEATURE } from '@ant/shared';
import {
  decideProjectJobGate,
  ensureUniversalContainer,
  getUniversalContainerPathOf,
  isUniversalProject,
  resolveUniversalContainerPath,
  UNIVERSAL_ARTIFACT_CANONICAL_DIRS,
} from '../../src/core/customAgents/universalContainer';
import { getSessionFilePath } from '../../src/core/utils/sessionPaths';

let projectPath: string;

function writeConfig(config: unknown): void {
  fs.writeFileSync(path.join(projectPath, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
}

beforeEach(() => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-universal-container-'));
});

afterEach(() => {
  fs.rmSync(projectPath, { recursive: true, force: true });
});

describe('resolveUniversalContainerPath — feature-slot truth table', () => {
  it.each([
    ['universal project + universal feature → container', { projectType: 'universal' }, UNIVERSAL_FEATURE, true],
    ['universal project + other feature → null', { projectType: 'universal' }, 'main', false],
    ['canonical project + universal feature → null', { projectType: 'canonical' }, UNIVERSAL_FEATURE, false],
    ['absent projectType + universal feature → null', {}, UNIVERSAL_FEATURE, false],
    ['malformed config → null', '{{{not json', UNIVERSAL_FEATURE, false],
  ] as const)('%s', (_label, config, featureName, resolves) => {
    writeConfig(config);
    const resolved = resolveUniversalContainerPath(projectPath, featureName);
    if (resolves) {
      expect(resolved).toBe(path.join(projectPath, 'universal'));
    } else {
      expect(resolved).toBeNull();
    }
  });

  it('missing config.json → null (and isUniversalProject false)', () => {
    expect(resolveUniversalContainerPath(projectPath, UNIVERSAL_FEATURE)).toBeNull();
    expect(isUniversalProject(projectPath)).toBe(false);
  });
});

describe('decideProjectJobGate — bidirectional truth table', () => {
  it.each([
    ['universal × code', 'universal', 'code', 'project-universal-requires-custom-job'],
    ['universal × design', 'universal', 'design', 'project-universal-requires-custom-job'],
    ['universal × learn', 'universal', 'learn', 'project-universal-requires-custom-job'],
    ['universal × plan', 'universal', 'plan', 'project-universal-requires-custom-job'],
    ['universal × visual', 'universal', 'visual', 'project-universal-requires-custom-job'],
    ['universal × inline-ask', 'universal', 'inline-ask', 'project-universal-requires-custom-job'],
    ['universal × universal', 'universal', 'universal', null],
    ['canonical × universal', 'canonical', 'universal', 'project-not-universal'],
    ['canonical × code', 'canonical', 'code', null],
    ['absent (defaults canonical) × universal', undefined, 'universal', 'project-not-universal'],
    ['absent (defaults canonical) × code', undefined, 'code', null],
  ] as const)('%s', (_label, projectType, jobType, expectedCode) => {
    const gate = decideProjectJobGate(projectType, jobType);
    if (expectedCode === null) {
      expect(gate).toEqual({ ok: true });
    } else {
      expect(gate).toEqual({ ok: false, code: expectedCode });
    }
  });
});

describe('ensureUniversalContainer', () => {
  it('materializes artifacts/ (+ canonical dirs) + sessions/ and is idempotent', () => {
    ensureUniversalContainer(projectPath);
    const container = getUniversalContainerPathOf(projectPath);
    expect(fs.statSync(path.join(container, 'artifacts')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(container, 'sessions')).isDirectory()).toBe(true);
    for (const dir of UNIVERSAL_ARTIFACT_CANONICAL_DIRS) {
      expect(fs.statSync(path.join(container, 'artifacts', dir)).isDirectory()).toBe(true);
    }
    expect(() => ensureUniversalContainer(projectPath)).not.toThrow();
  });

  it('canonical dir set matches the codespace vocabulary (plan)', () => {
    expect([...UNIVERSAL_ARTIFACT_CANONICAL_DIRS]).toEqual(['plan']);
  });
});

describe('per-(agentId, jobId) session path shape', () => {
  it('mirrors the canonical sessions/{agent}/{jobType}.json layout', () => {
    const container = getUniversalContainerPathOf(projectPath);
    expect(getSessionFilePath(container, 'sample-researcher', 'quick-answer')).toBe(
      path.join(projectPath, 'universal', 'sessions', 'sample-researcher', 'quick-answer.json'),
    );
  });
});

describe('thread-plane tombstones (deletion commit)', () => {
  it('threadPaths.ts stays deleted', () => {
    expect(fs.existsSync(path.join(__dirname, '../../src/core/customAgents/threadPaths.ts'))).toBe(false);
  });

  it('ANT_THREAD_ID never appears in ant-cli sources', () => {
    const srcRoot = path.join(__dirname, '../../src');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && fs.readFileSync(full, 'utf-8').includes('ANT_THREAD_ID')) {
          hits.push(full);
        }
      }
    };
    walk(srcRoot);
    expect(hits).toEqual([]);
  });
});
