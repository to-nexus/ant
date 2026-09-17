/**
 * The fetch trigger inspector as a FLOW: four numbered cards, an inline
 * header whose `${secret:KEY}` shows its registration state and registers the
 * value in place, and a response explorer whose clicks write `items` / `key` /
 * `fields` into the definition. Assertions target data attributes, element
 * props and i18n KEYS (the react-i18next mock returns keys), never prose.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, create } from 'react-test-renderer';
import type { PipelineDef, PipelineFetchPreview } from '@ant/shared';

const { mockFetchCreds, mockSave, mockDelete, mockPreview } = vi.hoisted(() => ({
  mockFetchCreds: vi.fn(),
  mockSave: vi.fn(),
  mockDelete: vi.fn(),
  mockPreview: vi.fn(),
}));

vi.mock('../../src/infrastructure/http/api/accountAgents', () => ({
  fetchMcpCredentials: mockFetchCreds,
  saveMcpCredential: mockSave,
  deleteMcpCredential: mockDelete,
}));
vi.mock('../../src/infrastructure/http/api/pipelines', () => ({
  previewPipelineFetch: mockPreview,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../src/domain/store', () => ({
  useStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ selectedPipelineId: 'voc-inbox', selectedProject: 'proj' }),
}));

import { FetchPanel } from '../../src/presentation/components/Pipelines/inspector/FetchPanel';

type Renderer = ReturnType<typeof create>;

const DEF: PipelineDef = {
  version: 2,
  name: 'VOC',
  on: {
    fetch: {
      connection: { baseUrl: 'http://127.0.0.1:8933', headers: { Authorization: '${secret:VOC_TOKEN}', Accept: 'application/json' } },
      request: { method: 'GET', path: '/voc' },
      items: '$.items',
      key: '$.key',
      every: '1m',
    },
  },
  steps: [],
};

const PREVIEW: PipelineFetchPreview = {
  ok: true,
  mapping: { ok: true },
  seen: 2,
  skipped: 0,
  items: [{ key: 'VOC-1', claimed: false, fields: { amount: '7600' } }, { key: 'VOC-2', claimed: true }],
  sample: {
    t: 'obj',
    more: 0,
    entries: [
      [
        'items',
        {
          t: 'arr',
          total: 2,
          items: [{ t: 'obj', more: 0, entries: [['key', { t: 'str', v: 'VOC-1', cut: false }], ['amount', { t: 'num', v: 7600 }]] }],
        },
      ],
    ],
  },
};

async function render(def: PipelineDef, onChange: (d: PipelineDef) => void = () => {}): Promise<Renderer> {
  let tree: Renderer | undefined;
  await act(async () => {
    tree = create(<FetchPanel def={def} onChange={onChange} customAgents={[]} />);
    await Promise.resolve();
  });
  return tree!;
}

const byProp = (tree: Renderer, prop: string, value: string) => tree.root.findAll((n) => n.props?.[prop] === value);

describe('FetchPanel — the four-card flow', () => {
  beforeEach(() => {
    mockFetchCreds.mockReset().mockResolvedValue({ credentials: [{ key: 'OTHER', updatedAt: '2026-01-01T00:00:00Z' }] });
    mockSave.mockReset().mockResolvedValue({ success: true, key: 'VOC_TOKEN' });
    mockPreview.mockReset().mockResolvedValue(PREVIEW);
  });

  it('renders connection → request → mapping → polling as numbered sections, and the connection warns while a secret is unregistered', async () => {
    const tree = await render(DEF);
    const sections = tree.root.findAll((n) => typeof n.props?.['data-section'] === 'string' && n.type === 'section');
    expect(sections.map((s) => s.props['data-section'])).toEqual(['fetch-connection', 'fetch-request', 'fetch-mapping', 'fetch-polling']);
    const connection = byProp(tree, 'data-section', 'fetch-connection').find((n) => n.type === 'section')!;
    expect(connection.findAll((n) => n.props?.['data-status'] === 'warn').length).toBe(1);
    // The secret header row shows its registration state inline — no trip to Agent Settings.
    expect(byProp(tree, 'data-cred-status', 'unregistered').length).toBe(1);
    expect(byProp(tree, 'data-secret-ref', 'VOC_TOKEN').length).toBe(1);
    // A literal header stays a plain input (no status pill).
    expect(tree.root.findAll((n) => n.props?.['data-secret-ref'] !== undefined).length).toBe(1);
  });

  it('registering the value in place PUTs the account credential and flips the state to registered', async () => {
    const tree = await render(DEF);
    const editor = byProp(tree, 'data-cred-editor', 'VOC_TOKEN')[0];
    const input = editor.find((n) => n.type === 'input' && n.props.type === 'password');
    await act(async () => {
      input.props.onChange({ target: { value: 'Bearer devtoken' } });
    });
    const save = byProp(tree, 'data-cred-editor', 'VOC_TOKEN')[0].findAll((n) => n.type === 'button' && !n.props.disabled)[0];
    await act(async () => {
      await save.props.onClick();
    });
    expect(mockSave).toHaveBeenCalledWith('VOC_TOKEN', 'Bearer devtoken');
    expect(byProp(tree, 'data-cred-status', 'registered').length).toBe(1);
    expect(byProp(tree, 'data-cred-status', 'unregistered').length).toBe(0);
  });

  it('fetching the response shows the explorer and a pick writes paths into the definition', async () => {
    const changes: PipelineDef[] = [];
    const def: PipelineDef = { ...DEF, on: { fetch: { ...DEF.on!.fetch!, items: '$', key: '$', fields: undefined } } } as PipelineDef;
    const tree = await render(def, (d) => changes.push(d));
    const fetchBtn = byProp(tree, 'data-section', 'fetch-mapping')
      .find((n) => n.type === 'section')!
      .findAll((n) => n.type === 'button' && n.props.disabled === false)[0];
    await act(async () => {
      await fetchBtn.props.onClick();
    });
    expect(mockPreview).toHaveBeenCalledWith(def.on!.fetch, 'proj', 'voc-inbox');
    expect(tree.root.findAll((n) => n.props?.['data-explorer'] !== undefined).length).toBe(1);
    // Arm "pick items", click the array row → on.fetch.items = "$.items".
    const pickItems = byProp(tree, 'data-pick', 'items')[0];
    await act(async () => {
      pickItems.props.onClick();
    });
    const arrayRow = byProp(tree, 'data-path', '$.items')[0];
    await act(async () => {
      arrayRow.props.onClick();
    });
    expect(changes.at(-1)!.on!.fetch!.items).toBe('$.items');
  });

  it('a mapping failure keeps the sample on screen and reports the selection error', async () => {
    mockPreview.mockResolvedValue({ ...PREVIEW, mapping: { ok: false, error: 'on.fetch.items must start with "$"' }, items: [], seen: 0, skipped: 0 });
    const tree = await render(DEF);
    const fetchBtn = byProp(tree, 'data-section', 'fetch-mapping')
      .find((n) => n.type === 'section')!
      .findAll((n) => n.type === 'button' && n.props.disabled === false)[0];
    await act(async () => {
      await fetchBtn.props.onClick();
    });
    expect(tree.root.findAll((n) => n.props?.['data-explorer'] !== undefined).length).toBe(1);
    const mapping = byProp(tree, 'data-section', 'fetch-mapping').find((n) => n.type === 'section')!;
    expect(mapping.findAll((n) => n.props?.['data-status'] === 'warn').length).toBe(1);
  });
});
