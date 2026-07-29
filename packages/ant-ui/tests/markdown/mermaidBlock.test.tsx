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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

type Renderer = ReturnType<typeof create>;

async function renderBlock(code: string): Promise<Renderer> {
  let tree: Renderer | undefined;
  await act(async () => {
    tree = create(<MermaidBlock code={code} />);
    await Promise.resolve();
  });
  return tree!;
}

function findByAriaLabel(tree: Renderer, label: string) {
  return tree.root.findAll((node) => node.props != null && node.props['aria-label'] === label, {
    deep: true,
  });
}

function svgHosts(tree: Renderer) {
  return tree.root.findAll(
    (node) => typeof node.type === 'string' && node.props?.dangerouslySetInnerHTML != null,
    { deep: true },
  );
}

describe('MermaidBlock', () => {
  beforeEach(() => {
    mockInitialize.mockReset();
    mockRender.mockReset();
  });

  it('attempts mermaid rendering and shows svg', async () => {
    mockRender.mockResolvedValue({
      svg: '<svg data-testid="mermaid-svg"><g></g></svg>',
    });

    const tree = await renderBlock('graph TD\nA-->B');

    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tree.toJSON())).toContain('<svg');
  });

  it('falls back to code block when mermaid render fails', async () => {
    mockRender.mockRejectedValue(new Error('invalid mermaid'));

    const tree = await renderBlock('graph TD\nA--->');
    const json = JSON.stringify(tree.toJSON());

    // The message is i18n'd now — the mock echoes the key plus interpolation.
    expect(json).toContain('mermaid.renderFailed');
    expect(json).toContain('invalid mermaid');
    expect(json).toContain('graph TD\\nA--->');
  });

  // Unique code per test: svgCache is module-level and never evicted, so a shared
  // code string would be served from cache and skip the pending state entirely.
  it('shows the i18n rendering placeholder while mermaid is pending', async () => {
    mockRender.mockReturnValue(new Promise(() => {}));

    const tree = await renderBlock('graph TD\nPending-->Forever');

    expect(JSON.stringify(tree.toJSON())).toContain('mermaid.rendering');
  });

  it('exposes an expand affordance without losing the surface tokens', async () => {
    mockRender.mockResolvedValue({ svg: '<svg viewBox="0 0 100 50"></svg>' });

    const tree = await renderBlock('graph TD\nA-->B');

    expect(findByAriaLabel(tree, 'mermaid.expand')).toHaveLength(1);

    const [host] = svgHosts(tree);
    expect(host.props.className).toContain('cursor-zoom-in');
    expect(host.props.className).toContain('border-[color:var(--border-1)]');
    expect(host.props.className).toContain('bg-[color:var(--bg-surface)]');
  });

  it('opens the lightbox without unmounting the collapsed diagram', async () => {
    mockRender.mockResolvedValue({ svg: '<svg viewBox="0 0 100 50"></svg>' });

    const tree = await renderBlock('graph TD\nA-->B');
    const [button] = findByAriaLabel(tree, 'mermaid.expand');

    await act(async () => {
      button.props.onClick({ stopPropagation: () => {} });
    });

    expect(JSON.stringify(tree.toJSON())).toContain('mermaid-lightbox');
    // The collapsed diagram is a sibling of the overlay, so it must survive.
    expect(svgHosts(tree).some((n) => n.props.className?.includes('cursor-zoom-in'))).toBe(true);
  });

  it('restores the previous view when the lightbox closes', async () => {
    mockRender.mockResolvedValue({ svg: '<svg viewBox="0 0 100 50"></svg>' });

    const tree = await renderBlock('graph TD\nA-->B');
    const [button] = findByAriaLabel(tree, 'mermaid.expand');
    await act(async () => {
      button.props.onClick({ stopPropagation: () => {} });
    });

    const [close] = findByAriaLabel(tree, 'mermaid.close');
    await act(async () => {
      close.props.onClick();
    });

    const json = JSON.stringify(tree.toJSON());
    expect(json).not.toContain('mermaid-lightbox');
    expect(json).toContain('cursor-zoom-in');
  });

  it('opens from a click on the diagram body', async () => {
    mockRender.mockResolvedValue({ svg: '<svg viewBox="0 0 100 50"></svg>' });

    const tree = await renderBlock('graph TD\nA-->B');
    const host = svgHosts(tree).find((n) => n.props.className?.includes('cursor-zoom-in'))!;

    await act(async () => {
      host.props.onClick();
    });

    expect(JSON.stringify(tree.toJSON())).toContain('mermaid-lightbox');
  });
});
