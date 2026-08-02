/**
 * `.html` file icon — one extension must not wear two icons.
 *
 * The shared map (`getFileIcon`, used by chat file cards and the path pickers)
 * already binds `.html` to the HTML5 shield, but the artifact tree runs its own
 * 5-bucket palette that had no `html` case — so a handoff bundle's screens and
 * specimens showed the generic document fallback there while the same paths
 * showed the shield in chat. These pin both maps to the shield.
 */

import { describe, it, expect } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SiHtml5 } from 'react-icons/si';
import { File } from 'lucide-react';
import { getFileIcon } from '@/shared/utils/file-icons';
import { ArtifactFileIcon } from '@/presentation/components/ArtifactsPanel/ArtifactFileIcon';

const HTML_PATHS = [
  'visual/ui/handoff/screens/home.html',
  'visual/ui/handoff/components/carousel.html',
  'page.HTM',
];

describe('shared file-icons map', () => {
  it.each(HTML_PATHS)('binds %s to the HTML5 shield', (p) => {
    expect(getFileIcon(p).icon).toBe(SiHtml5);
  });
});

function renderIcon(name: string): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<ArtifactFileIcon name={name} />);
  });
  return tree;
}

describe('ArtifactFileIcon (artifact tree palette)', () => {
  it.each(HTML_PATHS)('renders the HTML5 shield for %s, not the generic file', (p) => {
    const tree = renderIcon(p.split('/').pop()!);
    expect(tree.root.findAllByType(SiHtml5)).toHaveLength(1);
    expect(tree.root.findAllByType(File)).toHaveLength(0);
  });

  it('still falls back to the generic file icon for unknown extensions', () => {
    expect(renderIcon('notes.xyz').root.findAllByType(File)).toHaveLength(1);
  });
});
