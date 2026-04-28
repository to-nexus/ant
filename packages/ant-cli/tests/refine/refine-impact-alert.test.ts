/**
 * F3.4 — emitRefineImpactAlert end-to-end test.
 *
 * Boots a temp feature directory with a synthetic design session
 * checkpoint, runs `emitRefineImpactAlert` with stubbed cascade
 * inputs, and asserts the appender received a `chat_status` line
 * with `statusType='refine_impact'` and a complete metadata payload.
 *
 * Also pins the explicit/infer / additive / unscannable mode-coverage
 * via the metadata content because the helper is the only place where
 * the three components (extract → diff → detect) compose.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { emitRefineImpactAlert } from '../../src/core/refine/refineImpactAlert';
import type { RefineImpactMetadata } from '@ant/shared';

interface CapturedCard {
  cardId: string;
  metadata: RefineImpactMetadata;
}

function makeAppenderStub() {
  const lines: CapturedCard[] = [];
  return {
    appender: {
      isReady: () => true,
      appendChatStatus(
        cardId: string,
        statusType: 'refine_impact',
        metadata: RefineImpactMetadata,
      ) {
        if (statusType !== 'refine_impact') return;
        lines.push({ cardId, metadata });
      },
    },
    lines,
  };
}

async function withFeature<T>(
  session: any,
  body: (featurePath: string) => Promise<T>,
): Promise<T> {
  const featurePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-f3-'));
  try {
    if (session !== null) {
      const sessionDir = path.join(featurePath, 'sessions', 'architect');
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(
        path.join(sessionDir, 'design.json'),
        JSON.stringify({ state: session }),
        'utf-8',
      );
    }
    return await body(featurePath);
  } finally {
    await fs.rm(featurePath, { recursive: true, force: true });
  }
}

const SERVICE_RAC = {
  refs: ['plan/prd.md'],
  context: [],
} as const;

const NO_PLAN_REF_RAC = {
  refs: ['architecture/spec/spec-foo.md'],
  context: ['plan/prd.md'],
} as const;

const designTask = (id: string, description: string) => ({
  id,
  name: id,
  type: 'doc',
  priority: 100,
  description,
  completed: false,
});

describe('emitRefineImpactAlert', () => {
  it('builds a chat_status payload that intersects diff × deps', async () => {
    await withFeature(
      {
        resolvedAction: SERVICE_RAC,
        taskQueue: [
          designTask('a', 'Implements PRD §6 / SC-Search'),
          designTask('b', 'Implements PRD §7 / CP-Pagination'),
        ],
      },
      async featurePath => {
        const stub = makeAppenderStub();
        const result = await emitRefineImpactAlert({
          featurePath,
          updatedDoc: 'prd.md',
          llmResponse: '<updated-sections>PRD §6, SC-Search</updated-sections>',
          appender: stub.appender,
        });

        expect(result.emitted).toBe(true);
        expect(stub.lines).toHaveLength(1);
        const card = stub.lines[0];
        expect(card.cardId).toBe('refine-impact:prd.md');
        expect(card.metadata.updatedDoc).toBe('prd.md');
        expect(card.metadata.updatedSections).toEqual(
          expect.arrayContaining(['PRD §6', 'SC-Search']),
        );
        expect(card.metadata.diffSources).toEqual(['llm-tag']);
        expect(card.metadata.affected.map(a => a.taskId)).toEqual(['a']);
        expect(card.metadata.affected[0].matchedSections).toEqual(
          expect.arrayContaining(['PRD §6', 'SC-Search']),
        );
        expect(card.metadata.unscannableTaskIds).toEqual([]);
      },
    );
  });

  it('hasPrdRef=false tasks land in unscannableTaskIds, not affected', async () => {
    await withFeature(
      {
        resolvedAction: NO_PLAN_REF_RAC,
        taskQueue: [designTask('a', 'Implements PRD §6 / SC-Search')],
      },
      async featurePath => {
        const stub = makeAppenderStub();
        const result = await emitRefineImpactAlert({
          featurePath,
          updatedDoc: 'prd.md',
          llmResponse: '<updated-sections>PRD §6</updated-sections>',
          appender: stub.appender,
        });

        expect(result.emitted).toBe(true);
        const card = stub.lines[0];
        expect(card.metadata.affected).toEqual([]);
        expect(card.metadata.unscannableTaskIds).toEqual(['a']);
      },
    );
  });

  it('emits nothing when diff and deps are both empty', async () => {
    await withFeature(null, async featurePath => {
      const stub = makeAppenderStub();
      const result = await emitRefineImpactAlert({
        featurePath,
        updatedDoc: 'prd.md',
        appender: stub.appender,
      });
      expect(result.emitted).toBe(false);
      expect(stub.lines).toEqual([]);
    });
  });

  it('cascade: directive provides the diff signal when LLM tag is missing', async () => {
    await withFeature(
      {
        resolvedAction: SERVICE_RAC,
        taskQueue: [designTask('a', 'Implements PRD §10 / RB-Seller')],
      },
      async featurePath => {
        const stub = makeAppenderStub();
        const result = await emitRefineImpactAlert({
          featurePath,
          updatedDoc: 'prd.md',
          directive: 'rewrite §10 permissions and tighten RB-Seller',
          appender: stub.appender,
        });
        expect(result.emitted).toBe(true);
        const card = stub.lines[0];
        expect(card.metadata.diffSources).toEqual(['directive']);
        expect(card.metadata.affected.map(a => a.taskId)).toEqual(['a']);
      },
    );
  });
});
