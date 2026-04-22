import type { FileNode } from '@/infrastructure/http/api';

function findFigmaJsonNode(tree: FileNode[]): FileNode | undefined {
  // Canonical location: outputs/design/ui/figma/figma.json
  const outputs = tree?.find(n => n.name === 'outputs');
  const design = outputs?.children?.find(n => n.name === 'design');
  const ui = design?.children?.find(n => n.name === 'ui');
  const figma = ui?.children?.find(n => n.name === 'figma');
  return figma?.children?.find(n => n.name === 'figma.json');
}

let figmaRefreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Creates the fileTree SSE handler. Detects figma.json changes and
 * triggers debounced figma refresh.
 */
export function createFileTreeSseHandler(get: any): (data: any) => void {
  return (data: any) => {
    if (data.type === 'initial' || data.type === 'update') {
      const tree = data.tree || data.fileTree;
      console.log(`[Timing] SSE fileTree received (type=${data.type}, nodes=${tree?.length ?? 0}) @${Math.round(performance.now())}ms`);

      const oldFigma = findFigmaJsonNode(get().fileTree);
      const newFigma = findFigmaJsonNode(tree);
      const figmaChanged =
        (oldFigma?.size !== newFigma?.size) ||
        (oldFigma?.modifiedTime !== newFigma?.modifiedTime) ||
        (!oldFigma && !!newFigma) ||
        (!!oldFigma && !newFigma);

      get().setFileTree(tree ?? []);

      if (figmaChanged) {
        if (figmaRefreshTimer) clearTimeout(figmaRefreshTimer);
        figmaRefreshTimer = setTimeout(() => {
          get().refreshFigmaPopulated?.();
          figmaRefreshTimer = null;
        }, 300);
      }
    }
  };
}
