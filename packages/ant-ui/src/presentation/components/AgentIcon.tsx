/**
 * The mark for ONE agent.
 *
 * `AgentLogo` (the Ant character) used to be every agent's face, because an
 * agent was user-authored and had no identity to theme. An agent can now carry
 * an uploaded icon in its definition dir, so this component is the single
 * resolver: uploaded bytes when the definition has them, the Ant character
 * otherwise (and always, for the built-in canonical agents, which have no
 * authoring surface to upload one from).
 *
 * The bytes are fetched, not linked: the endpoint answers
 * `Content-Disposition: attachment` so a direct navigation cannot render user
 * content on the API origin. Many surfaces draw the same agent at once — the
 * rail, the composer chip, the action cards, a pipeline node — so the blob URL
 * is memoised per `{agentId}:{version}` and the superseded one is revoked.
 */

import { useEffect, useState } from 'react';
import { useStore } from '@/domain/store';
import { fetchAgentIconBlob } from '@/infrastructure/http/api/accountAgents';
import { AgentLogo } from './AgentLogo';
import { selectAgentIcon } from '@/domain/store/selectors/agentIcon';

/** key = `${agentId}:${version}` — a re-upload changes the version, not the id. */
const cache = new Map<string, Promise<string>>();
/** agentId → the key currently cached, so a superseded blob URL is released. */
const liveKey = new Map<string, string>();

function loadIcon(agentId: string, version: number): Promise<string> {
  const key = `${agentId}:${version}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const previous = liveKey.get(agentId);
  if (previous && previous !== key) {
    const stale = cache.get(previous);
    cache.delete(previous);
    void stale?.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
  liveKey.set(agentId, key);

  const pending = fetchAgentIconBlob(agentId)
    .then((blob) => URL.createObjectURL(blob))
    .catch((error) => {
      // A failed load must not pin the failure forever — the next render retries.
      cache.delete(key);
      if (liveKey.get(agentId) === key) liveKey.delete(agentId);
      throw error;
    });
  cache.set(key, pending);
  return pending;
}

export function AgentIcon({
  agentId,
  size = 14,
  className,
  style,
}: {
  /** Absent for canonical agents and for placeholder chips — both fall back. */
  agentId?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const icon = useStore((s) => selectAgentIcon(s, agentId));
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId || !icon) {
      setSrc(null);
      return;
    }
    let alive = true;
    loadIcon(agentId, icon.version)
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [agentId, icon?.version]);

  if (!src) return <AgentLogo size={size} className={className} style={style} />;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        objectFit: 'contain',
        borderRadius: Math.max(2, Math.round(size / 6)),
        ...style,
      }}
    />
  );
}

/**
 * `AgentIcon` bound to one agent, as a component — the shape icon SLOTS take
 * (`RailRow.icon`, `TabItem.icon`, `ActionChip.icon`, all `LucideIcon`-shaped).
 *
 * Memoised per agent because those slots key their rendering on component
 * identity: a fresh closure each render remounts the row, which restarts the
 * tab strip's scroll-into-view and the chip's entrance animation.
 */
type BoundAgentIcon = ((props: { size?: number; className?: string; style?: React.CSSProperties }) => React.ReactElement) & {
  displayName?: string;
};
const bound = new Map<string, BoundAgentIcon>();

export function agentIconComponent(agentId: string) {
  const hit = bound.get(agentId);
  if (hit) return hit;
  const Bound: BoundAgentIcon = (props) => <AgentIcon agentId={agentId} {...props} />;
  Bound.displayName = `AgentIcon(${agentId})`;
  bound.set(agentId, Bound);
  return Bound;
}
