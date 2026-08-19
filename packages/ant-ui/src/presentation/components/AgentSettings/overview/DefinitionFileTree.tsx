/**
 * Read-only recursive tree over an agent's definition files
 * (`CustomAgentDefinitionFileNode[]`) — the file half of the rail's
 * file ↔ section isomorphism. Borrowed render pattern from
 * `common/FileTreePicker` (indent-by-level, folder toggle, expand set)
 * without its modal/multi-select machinery. Clicking a node NAVIGATES to the
 * card/screen that owns it (the shell decides via `classifyDefinitionPath`);
 * unownable files render dimmed. `selectedPath` highlights the file the
 * right pane currently expresses (its ancestors auto-expand, the row is
 * scrolled into view; a user's own collapse still wins).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, SquareArrowOutUpRight } from 'lucide-react';
import type { CustomAgentDefinitionFileNode } from '@ant/shared';
import { selectedRowLabel, selectedRowStyle } from '@/presentation/components/aurora/selection';
import { DEFINITION_DIR_KINDS, classifyDefinitionPath } from './definitionDocs';

/**
 * A node navigates when its path classifies AND the classification agrees with
 * what the node is: `jobs/{j}/` and `intents/{i}/` are LEVELS (their directory
 * is the level's identity), while the file kinds are cards. Crossing the two
 * would let a stray extension-less file open an intent that does not exist.
 */
function isNavigable(node: CustomAgentDefinitionFileNode): boolean {
  const { kind } = classifyDefinitionPath(node.path);
  if (kind === 'other') return false;
  return DEFINITION_DIR_KINDS.has(kind) === (node.type === 'directory');
}

function ancestorDirs(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

function NodeRow({
  node,
  level,
  expanded,
  onToggle,
  onOpenFile,
  selectedPath,
  dense,
  baseIndent,
}: {
  node: CustomAgentDefinitionFileNode;
  level: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  selectedPath?: string | null;
  dense?: boolean;
  baseIndent?: number;
}) {
  const isDir = node.type === 'directory';
  const isOpen = expanded.has(node.path);
  const navigable = isNavigable(node);
  const selected = selectedPath != null && node.path === selectedPath;
  const indentStep = dense ? 12 : 16;

  return (
    <>
      <button
        type="button"
        data-def-path={node.path}
        onClick={() => {
          if (isDir) {
            onToggle(node.path);
            if (navigable) onOpenFile(node.path); // a level's dir → that level's screen
          } else if (navigable) {
            onOpenFile(node.path);
          }
        }}
        className="w-full flex items-center gap-1.5 rounded transition-colors hover:bg-[color:var(--bg-hover)]"
        style={{
          paddingLeft: (baseIndent ?? 0) + level * indentStep + 6,
          paddingTop: dense ? 2 : 3,
          paddingBottom: dense ? 2 : 3,
          paddingRight: 6,
          cursor: isDir || navigable ? 'pointer' : 'default',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          ...selectedRowStyle('violet', selected),
        }}
      >
        {isDir ? (
          <>
            {isOpen ? (
              <ChevronDown size={12} style={{ color: 'var(--text-4)', flexShrink: 0 }} />
            ) : (
              <ChevronRight size={12} style={{ color: 'var(--text-4)', flexShrink: 0 }} />
            )}
            {isOpen ? (
              <FolderOpen size={13} style={{ color: 'var(--amber-500, var(--text-3))', flexShrink: 0 }} />
            ) : (
              <Folder size={13} style={{ color: 'var(--amber-500, var(--text-3))', flexShrink: 0 }} />
            )}
          </>
        ) : (
          <>
            <span style={{ width: 12, flexShrink: 0 }} />
            <FileText
              size={13}
              style={{ color: navigable ? 'var(--text-3)' : 'var(--text-5, var(--text-4))', flexShrink: 0 }}
            />
          </>
        )}
        <span
          style={{
            fontSize: dense ? 11 : 12,
            fontFamily: 'var(--font-mono)',
            color: isDir ? 'var(--text-2)' : navigable ? 'var(--text-2)' : 'var(--text-4)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...selectedRowLabel(selected, isDir || navigable ? 'var(--text-2)' : 'var(--text-4)'),
          }}
        >
          {node.name}
        </span>
        {navigable && (
          <SquareArrowOutUpRight size={10} style={{ color: 'var(--text-4)', flexShrink: 0, marginLeft: 2 }} />
        )}
      </button>
      {isDir &&
        isOpen &&
        (node.children ?? []).map((child) => (
          <NodeRow
            key={child.path}
            node={child}
            level={level + 1}
            expanded={expanded}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
            selectedPath={selectedPath}
            dense={dense}
            baseIndent={baseIndent}
          />
        ))}
    </>
  );
}

export function DefinitionFileTree({
  tree,
  onOpenFile,
  selectedPath,
  dense,
  baseIndent,
}: {
  tree: CustomAgentDefinitionFileNode[];
  onOpenFile: (path: string) => void;
  /** File the right pane currently expresses — highlighted, ancestors auto-open. */
  selectedPath?: string | null;
  /** Rail metrics (smaller font, tighter rows). */
  dense?: boolean;
  /** Extra left padding when nested under an agent row. */
  baseIndent?: number;
}) {
  // Top-level directories start expanded — the first glance already shows the
  // agent.yaml / base/ / jobs/ shape the docs describe. The selected file's
  // ancestors join the base set (a user's own collapse still wins via
  // `toggled`).
  const initialExpanded = useMemo(() => {
    const set = new Set(tree.filter((n) => n.type === 'directory').map((n) => n.path));
    if (selectedPath) for (const dir of ancestorDirs(selectedPath)) set.add(dir);
    return set;
  }, [tree, selectedPath]);
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());

  const expanded = useMemo(() => {
    const set = new Set(initialExpanded);
    for (const [path, open] of toggled) {
      if (open) set.add(path);
      else set.delete(path);
    }
    return set;
  }, [initialExpanded, toggled]);

  // Right→rail sync: the highlight is useless if the row sits outside the
  // rail's scroll window ('nearest' is a no-op when it is already visible).
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selectedPath) return;
    rootRef.current
      ?.querySelector(`[data-def-path="${CSS.escape(selectedPath)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedPath, expanded]);

  const onToggle = (path: string) =>
    setToggled((prev) => {
      const next = new Map(prev);
      next.set(path, !expanded.has(path));
      return next;
    });

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column' }}>
      {tree.map((node) => (
        <NodeRow
          key={node.path}
          node={node}
          level={0}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          selectedPath={selectedPath}
          dense={dense}
          baseIndent={baseIndent}
        />
      ))}
    </div>
  );
}
