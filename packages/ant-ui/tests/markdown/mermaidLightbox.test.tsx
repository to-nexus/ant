import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { MermaidLightbox } from '../../src/presentation/components/markdown/MermaidLightbox';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const SVG = '<svg width="100%" style="max-width: 1000px;" viewBox="0 0 1000 500"></svg>';

type Renderer = ReturnType<typeof create>;

async function renderLightbox(svg = SVG, onClose = () => {}): Promise<Renderer> {
  let tree: Renderer | undefined;
  await act(async () => {
    tree = create(<MermaidLightbox svg={svg} onClose={onClose} />);
    await Promise.resolve();
  });
  return tree!;
}

function transformHost(tree: Renderer) {
  return tree.root.findAll(
    (node) => typeof node.type === 'string' && node.props?.dangerouslySetInnerHTML != null,
    { deep: true },
  )[0];
}

function dialogNode(tree: Renderer) {
  return tree.root.findAll((node) => node.type === 'dialog', { deep: true })[0];
}

function surface(tree: Renderer) {
  return tree.root.findAll(
    (node) => node.props != null && node.props['data-testid'] === 'mermaid-lightbox',
    { deep: true },
  )[0];
}

function control(tree: Renderer, label: string) {
  return tree.root.findAll((node) => node.props != null && node.props['aria-label'] === label, {
    deep: true,
  })[0];
}

/**
 * Read the zoom readout's own text. The value renders as separate JSX children
 * (["120", "%"]), and the injected SVG markup itself contains `width="100%"` — so a
 * substring match on the serialized tree both misses the real value and false-positives.
 */
function zoomReadout(tree: Renderer): string {
  const children = control(tree, 'mermaid.actualSize').children as unknown[];
  return children.filter((c) => typeof c === 'string').join('');
}

function labels(tree: Renderer): string[] {
  return tree.root
    .findAll((node) => node.props != null && typeof node.props['aria-label'] === 'string', {
      deep: true,
    })
    .map((node) => node.props['aria-label'] as string);
}

describe('MermaidLightbox', () => {
  it('sizes the transform wrapper from the SVG viewBox', async () => {
    const tree = await renderLightbox();
    const host = transformHost(tree);

    expect(host.props.style.width).toBe(1000);
    expect(host.props.style.height).toBe(500);
    expect(host.props.style.transformOrigin).toBe('0 0');
    expect(host.props.style.transform).toMatch(
      /^translate\(-?[\d.]+px, -?[\d.]+px\) scale\([\d.]+\)$/,
    );
  });

  // Without this class mermaid's inline `max-width` wins and fit silently breaks
  // with no other visible symptom.
  it('neutralizes the inline max-width on the injected svg', async () => {
    const tree = await renderLightbox();
    expect(transformHost(tree).props.className).toContain('[&>svg]:!max-w-none');
  });

  it('blocks browser gesture capture and scroll chaining on the surface', async () => {
    const tree = await renderLightbox();
    const style = surface(tree).props.style;

    expect(style.touchAction).toBe('none');
    expect(style.overscrollBehavior).toBe('contain');
  });

  it('renders the full toolbar control set', async () => {
    const tree = await renderLightbox();
    const found = labels(tree);

    for (const key of [
      'mermaid.zoomOut',
      'mermaid.zoomIn',
      'mermaid.reset',
      'mermaid.actualSize',
    ]) {
      expect(found).toContain(key);
    }
  });

  it('owns its own close label rather than borrowing the chat namespace', async () => {
    const tree = await renderLightbox();
    const found = labels(tree);

    expect(found).toContain('mermaid.close');
    expect(found).not.toContain('draftSelection.close');
  });

  it('starts at 100% when the viewport is unmeasured', async () => {
    const tree = await renderLightbox();
    expect(zoomReadout(tree)).toBe('100%');
  });

  it('falls back to a default size when the svg carries no size signal', async () => {
    const tree = await renderLightbox('<svg><g></g></svg>');
    const host = transformHost(tree);

    expect(host.props.style.width).toBe(800);
    expect(host.props.style.height).toBe(600);
  });

  it('zooms in and out by a symmetric step from the toolbar', async () => {
    const tree = await renderLightbox();

    await act(async () => {
      control(tree, 'mermaid.zoomIn').props.onClick();
    });
    expect(zoomReadout(tree)).toBe('120%');

    await act(async () => {
      control(tree, 'mermaid.zoomOut').props.onClick();
    });
    expect(zoomReadout(tree)).toBe('100%');
  });

  it('returns to actual size from the zoom readout', async () => {
    const tree = await renderLightbox();
    await act(async () => {
      control(tree, 'mermaid.zoomIn').props.onClick();
    });
    await act(async () => {
      control(tree, 'mermaid.zoomIn').props.onClick();
    });
    expect(zoomReadout(tree)).toBe('144%');

    await act(async () => {
      control(tree, 'mermaid.actualSize').props.onClick();
    });
    expect(zoomReadout(tree)).toBe('100%');
  });

  it('uses the app canvas for the scrim instead of a neutral dark overlay', async () => {
    const tree = await renderLightbox();
    const dialog = dialogNode(tree);

    expect(dialog.props.style?.background).toContain('var(--bg-canvas)');
    expect(dialog.props.className).not.toContain('bg-black/80');
  });

  // The collapsed block in MermaidBlock uses --bg-surface; expanding must not look
  // like a differently-themed window.
  it('puts the diagram on the same surface token as the collapsed block', async () => {
    const tree = await renderLightbox();
    expect(transformHost(tree).props.style.background).toBe('var(--bg-surface)');
  });

  it('outlines the diagram without consuming layout width', async () => {
    const tree = await renderLightbox();
    const style = transformHost(tree).props.style;

    expect(style.boxShadow).toContain('var(--border-1)');
    expect(style.border).toBeUndefined();
    // A border would shrink the content box and skew the viewBox-exact sizing.
    expect(style.width).toBe(1000);
  });

  it('keeps the diagram within bounds when panning past an edge', async () => {
    const tree = await renderLightbox();
    const surfaceNode = surface(tree);

    // Viewport is unmeasured in this environment, so no bound is knowable and the
    // translation must survive untouched — the clamp must not zero out a real drag.
    await act(async () => {
      surfaceNode.props.onPointerDown({
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        currentTarget: { setPointerCapture: () => {}, hasPointerCapture: () => true, releasePointerCapture: () => {} },
      });
      surfaceNode.props.onPointerMove({ pointerId: 1, clientX: 40, clientY: 25 });
    });

    expect(transformHost(tree).props.style.transform).toBe('translate(40px, 25px) scale(1)');
  });

  it('invokes onClose from the shell close button', async () => {
    const onClose = vi.fn();
    const tree = await renderLightbox(SVG, onClose);

    await act(async () => {
      control(tree, 'mermaid.close').props.onClick();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
