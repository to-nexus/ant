/**
 * The fetch inspector's mapping helpers — how a click in the response sample
 * becomes an item-path and how paths read back against the sample. Pure
 * functions; the grammar itself is @ant/shared's and pinned there.
 */

import { describe, expect, it } from 'vitest';
import { formatItemPath, parseItemPath, type PipelineFetchSampleNode } from '@ant/shared';
import { absoluteFromItem, firstItemSegments, pathError, relativeToItem, sampleAt, sampleText, segmentsOf, suggestFieldName, suggestSecretKey } from '../../src/presentation/components/Pipelines/inspector/fetch/fetchMapping';
import { recordToRows, rowsToRecord, setRow } from '../../src/presentation/components/Pipelines/inspector/primitives/keyValue';

const str = (v: string): PipelineFetchSampleNode => ({ t: 'str', v, cut: false });
const obj = (entries: Array<[string, PipelineFetchSampleNode]>, more = 0): PipelineFetchSampleNode => ({ t: 'obj', entries, more });
const SAMPLE: PipelineFetchSampleNode = obj([
  ['total', { t: 'num', v: 2 }],
  [
    'issues',
    {
      t: 'arr',
      total: 12,
      items: [
        obj([
          ['key', str('OPS-1')],
          ['fields', obj([['summary', str('refund A')], ['Sales Channel', str('web')]], 3)],
        ]),
        obj([['key', str('OPS-2')]]),
      ],
    },
  ],
]);

describe('formatItemPath ⇄ parseItemPath', () => {
  it('round-trips member, bracketed and index segments', () => {
    for (const p of ['$', '$.issues', '$.issues[0].key', "$.fields['Sales Channel']", '$[3].x-y']) {
      const segs = parseItemPath(p, 'p');
      expect(typeof segs).not.toBe('string');
      expect(parseItemPath(formatItemPath(segs as never), 'p')).toEqual(segs);
    }
  });
  it('quotes a name the dotted form cannot carry, with the delimiter it does not contain', () => {
    expect(formatItemPath([{ kind: 'key', name: 'a b' }])).toBe("$['a b']");
    expect(formatItemPath([{ kind: 'key', name: "it's" }])).toBe('$["it\'s"]');
  });
});

describe('sample navigation', () => {
  it('sampleAt walks members and indexes; a shape disagreement is undefined', () => {
    expect(sampleText(sampleAt(SAMPLE, segmentsOf('$.issues[0].key')!))).toBe('OPS-1');
    expect(sampleText(sampleAt(SAMPLE, segmentsOf('$.issues')!))).toBe('[12]');
    expect(sampleAt(SAMPLE, segmentsOf('$.issues.key')!)).toBeUndefined();
    expect(sampleAt(SAMPLE, segmentsOf('$.total[0]')!)).toBeUndefined();
  });
  it('key/field paths are relative to the FIRST element of the items array', () => {
    expect(firstItemSegments('$.issues')).toEqual([{ kind: 'key', name: 'issues' }, { kind: 'index', index: 0 }]);
    expect(formatItemPath(absoluteFromItem('$.issues', '$.fields.summary')!)).toBe('$.issues[0].fields.summary');
    expect(absoluteFromItem('not a path', '$.key')).toBeNull();
  });
  it('a click inside items[n] becomes an element-relative path; a click elsewhere is null', () => {
    expect(formatItemPath(relativeToItem('$.issues', segmentsOf('$.issues[1].fields.summary')!)!)).toBe('$.fields.summary');
    expect(relativeToItem('$.issues', segmentsOf('$.total')!)).toBeNull();
    expect(relativeToItem('$.issues', segmentsOf('$.issues')!)).toBeNull();
    expect(relativeToItem('$.other', segmentsOf('$.issues[0].key')!)).toBeNull();
  });
  it('pathError is null for a valid path and the grammar message otherwise', () => {
    expect(pathError('$.issues[0]')).toBeNull();
    expect(pathError('issues')).toMatch(/must start with/);
  });
});

describe('name suggestions', () => {
  it('suggestFieldName lowerCamels the last member, avoids the reserved key and taken names', () => {
    expect(suggestFieldName(segmentsOf("$.fields['Sales Channel']")!)).toBe('salesChannel');
    expect(suggestFieldName(segmentsOf('$.fields.customfield_10021')!)).toBe('customfield10021');
    expect(suggestFieldName(segmentsOf('$.key')!)).toBe('field');
    expect(suggestFieldName(segmentsOf('$.summary')!, ['summary'])).toBe('summary2');
    expect(suggestFieldName(segmentsOf('$[0]')!)).toBe('field');
  });
  it('suggestSecretKey builds an upper-snake key from pipeline id and header', () => {
    expect(suggestSecretKey(['voc-inbox', 'Authorization'])).toBe('VOC_INBOX_AUTHORIZATION');
    expect(suggestSecretKey(['9lives', 'X-Api-Key'])).toBe('K_9LIVES_X_API_KEY');
    expect(suggestSecretKey(['캐쉬 환불', ''])).toBe('API_TOKEN');
  });
});

describe('key/value rows ⇄ record', () => {
  it('blank names are dropped, later duplicates win, empty becomes undefined', () => {
    expect(rowsToRecord([['a', '1'], ['', 'x'], ['a', '2']])).toEqual({ a: '2' });
    expect(rowsToRecord([['', '']])).toBeUndefined();
    expect(recordToRows({ a: 1, b: true })).toEqual([['a', '1'], ['b', 'true']]);
    expect(setRow([['a', '1']], 0, { value: '9' })).toEqual([['a', '9']]);
  });
});
