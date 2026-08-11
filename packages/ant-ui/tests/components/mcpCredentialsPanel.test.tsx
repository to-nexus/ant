/**
 * MCP credentials panel row states — one row per (registered × editing)
 * combination. The invariant under test: a registered credential renders
 * masked (no raw password input) until its Edit flip, an unregistered key
 * gets the input directly, and a registered-but-unreferenced key stays on
 * screen with its delete affordance. Assertions target element types, props
 * and i18n KEYS (the react-i18next mock returns keys), never display prose.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, create } from 'react-test-renderer';
import type { McpServerConfig } from '@ant/shared';

const { mockFetch, mockSave, mockDelete } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockSave: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('../../src/infrastructure/http/api/accountAgents', () => ({
  fetchMcpCredentials: mockFetch,
  saveMcpCredential: mockSave,
  deleteMcpCredential: mockDelete,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { McpServersEditor } from '../../src/presentation/components/AgentSettings/overview/McpServersEditor';

type Renderer = ReturnType<typeof create>;
type Instance = Renderer['root'];

const SERVERS: Record<string, McpServerConfig> = {
  api: {
    transport: 'http',
    url: 'https://x/mcp',
    headers: {
      Authorization: '${secret:REG_KEY}',
      'X-New': '${secret:NEW_KEY}',
      'X-Plain': 'ws-abc',
    },
  },
};

async function renderEditor(onChange: (next: Record<string, McpServerConfig>) => void = () => {}): Promise<Renderer> {
  let tree: Renderer | undefined;
  await act(async () => {
    tree = create(<McpServersEditor servers={SERVERS} disabled={false} onChange={onChange} />);
    await Promise.resolve();
  });
  return tree!;
}

function credRow(tree: Renderer, key: string): Instance {
  return tree.root.find((n) => n.props != null && n.props['data-cred-key'] === key);
}

function passwordInputs(scope: Instance) {
  return scope.findAll((n) => n.type === 'input' && n.props.type === 'password');
}

function textOf(node: Instance): string {
  const parts: string[] = [];
  const walk = (children: unknown): void => {
    for (const c of Array.isArray(children) ? children : [children]) {
      if (typeof c === 'string') parts.push(c);
      else if (c && typeof c === 'object' && 'children' in (c as Instance)) walk((c as Instance).children);
    }
  };
  walk(node.children);
  return parts.join('');
}

function buttonWithText(scope: Instance, text: string): Instance {
  const hit = scope
    .findAll((n) => n.type === 'button')
    .find((b) => textOf(b).includes(text));
  if (!hit) throw new Error(`no button containing "${text}"`);
  return hit;
}

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue({
    credentials: [
      { key: 'REG_KEY', updatedAt: '2026-08-01T00:00:00Z' },
      { key: 'ORPHAN_KEY', updatedAt: '2026-08-02T00:00:00Z' },
    ],
  });
  mockSave.mockReset().mockResolvedValue({ success: true });
  mockDelete.mockReset().mockResolvedValue({ success: true });
});

describe('credential panel row states', () => {
  it('renders a row per union key — including the registered-but-unreferenced orphan', async () => {
    const tree = await renderEditor();
    for (const key of ['REG_KEY', 'NEW_KEY', 'ORPHAN_KEY']) expect(credRow(tree, key)).toBeTruthy();
    expect(textOf(credRow(tree, 'ORPHAN_KEY'))).toContain('agentDef.mcpCredUnreferenced');
    expect(textOf(credRow(tree, 'NEW_KEY'))).not.toContain('agentDef.mcpCredUnreferenced');
  });

  it('registered + idle → masked: no password input, Edit and delete affordances present', async () => {
    const tree = await renderEditor();
    const row = credRow(tree, 'REG_KEY');
    expect(passwordInputs(row)).toHaveLength(0);
    expect(textOf(row)).toContain('agentDef.mcpCredEdit');
    expect(
      row.findAll((n) => n.type === 'button' && n.props.title === 'agentDef.mcpCredDelete'),
    ).toHaveLength(1);
  });

  it('unregistered → the password input shows directly, with no Cancel', async () => {
    const tree = await renderEditor();
    const row = credRow(tree, 'NEW_KEY');
    expect(passwordInputs(row)).toHaveLength(1);
    expect(textOf(row)).not.toContain('tree.cancel');
    expect(
      row.findAll((n) => n.type === 'button' && n.props.title === 'agentDef.mcpCredDelete'),
    ).toHaveLength(0);
  });

  it('registered + Edit flip → password input and Cancel appear; Cancel collapses back to masked', async () => {
    const tree = await renderEditor();
    await act(async () => {
      buttonWithText(credRow(tree, 'REG_KEY'), 'agentDef.mcpCredEdit').props.onClick();
    });
    const editing = credRow(tree, 'REG_KEY');
    expect(passwordInputs(editing)).toHaveLength(1);
    await act(async () => {
      buttonWithText(editing, 'tree.cancel').props.onClick();
    });
    expect(passwordInputs(credRow(tree, 'REG_KEY'))).toHaveLength(0);
  });
});

describe('binding rows — credential mode wiring', () => {
  it('valid ${secret:…} values get a jump affordance; plain text does not', async () => {
    const tree = await renderEditor();
    const jumps = tree.root.findAll(
      (n) => n.type === 'button' && n.props.title === 'agentDef.mcpCredJump',
    );
    expect(jumps).toHaveLength(2); // REG_KEY + NEW_KEY, not the plain-text header
  });

  it('a new header row is born in credential mode (empty secret wrapper, never bare plain text)', async () => {
    let next: Record<string, McpServerConfig> | undefined;
    const tree = await renderEditor((n) => {
      next = n;
    });
    await act(async () => {
      buttonWithText(tree.root, 'agentDef.mcpAddHeader').props.onClick();
    });
    expect(next?.api.headers?.['']).toBe('${secret:}');
  });

  it('the lock toggle unwraps a reference to plain text keeping the key text', async () => {
    let next: Record<string, McpServerConfig> | undefined;
    const tree = await renderEditor((n) => {
      next = n;
    });
    const toggle = tree.root
      .findAll((n) => n.type === 'button' && n.props['aria-pressed'] === true)
      .find((b) => b.props.title === 'agentDef.mcpValueModeSecret');
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle!.props.onClick();
    });
    expect(Object.values(next?.api.headers ?? {})).toContain('REG_KEY');
  });
});
