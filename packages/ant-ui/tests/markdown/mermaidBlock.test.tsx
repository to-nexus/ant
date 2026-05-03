import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, create } from 'react-test-renderer';
import { MermaidBlock } from '../../src/presentation/components/markdown/MermaidBlock';

const { mockInitialize, mockRender } = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockRender: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: mockInitialize,
    render: mockRender,
  },
}));

describe('MermaidBlock', () => {
  beforeEach(() => {
    mockInitialize.mockReset();
    mockRender.mockReset();
  });

  it('attempts mermaid rendering and shows svg', async () => {
    mockRender.mockResolvedValue({
      svg: '<svg data-testid="mermaid-svg"><g></g></svg>',
    });

    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<MermaidBlock code={'graph TD\nA-->B'} />);
      await Promise.resolve();
    });

    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledTimes(1);
    const node = tree!.toJSON() as { props?: { dangerouslySetInnerHTML?: { __html: string } } };
    expect(node.props?.dangerouslySetInnerHTML?.__html).toContain('<svg');
  });

  it('falls back to code block when mermaid render fails', async () => {
    mockRender.mockRejectedValue(new Error('invalid mermaid'));

    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<MermaidBlock code={'graph TD\nA--->'} />);
      await Promise.resolve();
    });

    const json = tree!.toJSON();
    expect(JSON.stringify(json)).toContain('Mermaid rendering failed');
    expect(JSON.stringify(json)).toContain('graph TD\\nA--->');
  });
});
