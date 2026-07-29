/**
 * Regression guard for the LightboxShell extraction: the image lightboxes must keep
 * their chat-namespace labels, their scrim, and their centered layout.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import {
  DraftLightbox,
  ImageLightbox,
} from '../../src/presentation/components/chat/ImageLightbox';
import { LightboxShell } from '../../src/presentation/components/common/LightboxShell';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

// DraftLightbox registers a window keydown listener (pre-existing behavior); the test
// environment has no DOM, so give it the two methods it touches.
beforeAll(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

type Renderer = ReturnType<typeof create>;

/** Concatenate every string leaf in the rendered tree. */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'children' in node) {
    return textOf((node as { children: unknown }).children);
  }
  return '';
}

async function render(element: React.ReactElement): Promise<Renderer> {
  let tree: Renderer | undefined;
  await act(async () => {
    tree = create(element);
    await Promise.resolve();
  });
  return tree!;
}

function dialogNode(tree: Renderer) {
  return tree.root.findAll((node) => node.type === 'dialog', { deep: true })[0];
}

describe('LightboxShell extraction', () => {
  it('keeps the full-viewport dark scrim for image previews', async () => {
    const tree = await render(<ImageLightbox src="/a.png" onClose={() => {}} />);
    const className = dialogNode(tree).props.className as string;

    for (const token of [
      'fixed inset-0',
      'w-screen',
      'h-screen',
      'bg-black/80',
      'backdrop-blur-sm',
    ]) {
      expect(className).toContain(token);
    }
  });

  it('swaps the scrim and the close button colors for the canvas variant', async () => {
    const dark = await render(
      <LightboxShell onClose={() => {}} closeLabel="x">
        <span />
      </LightboxShell>,
    );
    const darkClose = dark.root.findAll(
      (node) => node.props != null && node.props['aria-label'] === 'x',
      { deep: true },
    )[0];
    // --text-on-brand is #ffffff in BOTH themes, so it only works on a dark scrim.
    expect(darkClose.props.style.color).toBe('var(--text-on-brand)');

    const canvas = await render(
      <LightboxShell onClose={() => {}} closeLabel="x" scrim="canvas">
        <span />
      </LightboxShell>,
    );
    expect(dialogNode(canvas).props.className).not.toContain('bg-black/80');
    expect(dialogNode(canvas).props.style.background).toContain('var(--bg-canvas)');

    const canvasClose = canvas.root.findAll(
      (node) => node.props != null && node.props['aria-label'] === 'x',
      { deep: true },
    )[0];
    expect(canvasClose.props.style.color).toBe('var(--text-2)');
  });

  it('centers content with padding by default and bleeds when asked', async () => {
    const centered = await render(
      <LightboxShell onClose={() => {}} closeLabel="x">
        <span />
      </LightboxShell>,
    );
    const centeredInner = dialogNode(centered).children[0] as { props: { className: string } };
    expect(centeredInner.props.className).toContain('flex items-center justify-center');
    expect(centeredInner.props.className).toContain('p-8');

    const bleed = await render(
      <LightboxShell onClose={() => {}} closeLabel="x" layout="bleed">
        <span />
      </LightboxShell>,
    );
    const bleedInner = dialogNode(bleed).children[0] as { props: { className: string } };
    expect(bleedInner.props.className).not.toContain('items-center');
    expect(bleedInner.props.className).not.toContain('p-8');
    expect(bleedInner.props.className).toContain('w-full h-full');
  });

  it('keeps ImageLightbox on the chat close label and object-contain sizing', async () => {
    const tree = await render(<ImageLightbox src="/a.png" alt="shot" onClose={() => {}} />);
    const json = JSON.stringify(tree.toJSON());

    expect(json).toContain('draftSelection.close');
    expect(json).toContain('max-w-[90vw] max-h-[90vh] object-contain');
  });

  it('keeps DraftLightbox navigation, indicator, and select action', async () => {
    const images = [
      { index: 0, objectUrl: '/0.png' },
      { index: 1, objectUrl: '/1.png' },
    ];
    const tree = await render(
      <DraftLightbox images={images} startIndex={0} onClose={() => {}} onSelect={() => {}} />,
    );
    const json = JSON.stringify(tree.toJSON());

    expect(json).toContain('draftSelection.close');
    expect(json).toContain('draftSelection.nextDraft');
    expect(json).toContain('draftSelection.selectDraft');
    // The indicator renders as separate JSX children, so match on extracted text.
    expect(textOf(tree.toJSON())).toContain('1 / 2');
  });

  it('routes the shell close button to onClose', async () => {
    const onClose = vi.fn();
    const tree = await render(<ImageLightbox src="/a.png" onClose={onClose} />);
    const close = tree.root.findAll(
      (node) => node.props != null && node.props['aria-label'] === 'draftSelection.close',
      { deep: true },
    )[0];

    await act(async () => {
      close.props.onClick();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
