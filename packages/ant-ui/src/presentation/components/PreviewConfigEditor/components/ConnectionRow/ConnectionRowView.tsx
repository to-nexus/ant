import { useState } from 'react';
import {
  Pencil,
  MessageSquare,
  Server,
  Database,
  ArrowRight,
  Package,
  Box,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ServiceConnection } from '@/infrastructure/http/api';
import { SignalRing } from '@/presentation/components/ConfigEditor/aurora';
import type { SignalRingState } from '@/presentation/components/ConfigEditor/aurora';
import { getResolutionLabel, generateFixMessage } from '../../utils';
import { VirtualizationToggle } from './VirtualizationToggle';

const CATEGORY_META: Record<
  string,
  { gradient: string; Icon: LucideIcon }
> = {
  business: {
    gradient:
      'linear-gradient(135deg, oklch(60% 0.18 250), oklch(56% 0.20 280))',
    Icon: Server,
  },
  infrastructure: {
    gradient:
      'linear-gradient(135deg, oklch(68% 0.18 50), oklch(64% 0.20 30))',
    Icon: Database,
  },
};

const RESOLUTION_CHIP_TONE: Record<
  string,
  { bg: string; fg: string; border: string; Icon: LucideIcon }
> = {
  url: {
    bg: 'var(--bg-surface-2)',
    fg: 'var(--text-3)',
    border: 'var(--border-2)',
    Icon: ArrowRight,
  },
  docker: {
    bg: 'oklch(94% 0.06 220)',
    fg: 'oklch(48% 0.18 220)',
    border: 'oklch(80% 0.10 220)',
    Icon: Package,
  },
  'ant-project': {
    bg: 'oklch(94% 0.06 290)',
    fg: 'var(--violet-700)',
    border: 'var(--violet-200)',
    Icon: Box,
  },
};

function ringStateForConn(conn: ServiceConnection): SignalRingState | null {
  if (conn.resolution.type === 'url') return null;
  switch (conn.status) {
    case 'active':
      return 'running';
    case 'starting':
      return 'starting';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

/**
 * Read-only display of a connection. The Virtualization toggle (if the
 * connection has one) sits in the badge row so the user can flip
 * Real/Virtualized without entering edit mode — toggle persistence
 * happens via `onToggleVirtualization` (writes `.env` on the BE).
 */
export function ConnectionRowView({
  conn,
  onEdit,
  onUpdate,
  onFix,
  onToggleVirtualization,
}: {
  conn: ServiceConnection;
  onEdit: () => void;
  onUpdate: (updates: Partial<ServiceConnection>) => void;
  onFix: (msg: string) => void;
  onToggleVirtualization?: (active: boolean) => void;
}) {
  const [hover, setHover] = useState(false);
  const catMeta = CATEGORY_META[conn.category] || CATEGORY_META.business;
  const CatIcon = catMeta.Icon;
  const resTone =
    RESOLUTION_CHIP_TONE[conn.resolution.type] || RESOLUTION_CHIP_TONE.url;
  const ResIcon = resTone.Icon;
  const ring = ringStateForConn(conn);
  const dirty = conn.missingAnnotation || conn.userModified;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        padding: 12,
        paddingLeft: 14,
        background: 'var(--bg-surface)',
        border: `1.5px solid ${hover ? 'var(--violet-300)' : 'var(--border-2)'}`,
        borderRadius: 'var(--r-lg)',
        overflow: 'hidden',
        minHeight: 96,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        boxShadow: hover
          ? '0 4px 12px -6px oklch(55% 0.18 290 / 0.25)'
          : 'none',
      }}
    >
      {/* Category accent strip */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: catMeta.gradient,
        }}
      />

      {/* Dirty corner indicator */}
      {dirty && (
        <span
          title={
            conn.userModified
              ? 'Changes not yet applied to project files'
              : 'Missing @connection annotation in .env.example'
          }
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            padding: '1px 6px',
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            background: 'oklch(94% 0.06 50)',
            color: 'oklch(50% 0.16 50)',
            border: '1px solid oklch(82% 0.10 50)',
            borderRadius: 'var(--r-pill)',
          }}
        >
          {conn.userModified ? 'MODIFIED' : '!ANNOTATION'}
        </span>
      )}

      {/* Header: avatar + name + ring */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          paddingRight: dirty ? 80 : 0,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 24,
            height: 24,
            borderRadius: 'var(--r-sm)',
            background: catMeta.gradient,
            color: 'white',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <CatIcon size={12} strokeWidth={2.2} />
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 800,
            color: 'var(--text-1)',
            letterSpacing: '-0.005em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={conn.name}
        >
          {conn.name}
        </span>
        {ring && <SignalRing state={ring} size={9} />}
      </div>

      {/* Resolution chip row */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '2px 8px',
            borderRadius: 'var(--r-sm)',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            background: resTone.bg,
            color: resTone.fg,
            border: `1px solid ${resTone.border}`,
          }}
        >
          <ResIcon size={9} strokeWidth={2.4} />
          {conn.resolution.type}
        </span>
        {conn.source && conn.source !== '*' && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-4)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 120,
            }}
            title={conn.source}
          >
            {conn.source}
          </span>
        )}
        {onToggleVirtualization && (
          <VirtualizationToggle
            conn={conn}
            onToggle={onToggleVirtualization}
          />
        )}
      </div>

      {/* Env var + resolution label */}
      <div
        style={{
          marginTop: 'auto',
          paddingTop: 8,
          borderTop: '1px dashed var(--border-1)',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
        }}
      >
        <code
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={conn.envVar}
        >
          {conn.envVar}
        </code>
        <code
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: 'var(--text-4)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={
            conn.resolution.type !== 'url' && conn.value
              ? conn.value
              : getResolutionLabel(conn)
          }
        >
          ↳ {getResolutionLabel(conn)}
        </code>
      </div>

      {/* Hover actions */}
      {hover && (
        <div
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <button
            type="button"
            onClick={onEdit}
            title="Edit"
            style={{
              width: 22,
              height: 22,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-2)',
              borderRadius: 'var(--r-sm)',
              color: 'var(--text-3)',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <Pencil size={10} strokeWidth={2.2} />
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => {
                onFix(generateFixMessage(conn));
                onUpdate({ userModified: false });
              }}
              title="Apply changes to project files"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '3px 7px',
                fontSize: 10,
                fontWeight: 700,
                background: 'oklch(94% 0.06 50)',
                color: 'oklch(50% 0.16 50)',
                border: '1px solid oklch(82% 0.10 50)',
                borderRadius: 'var(--r-sm)',
                cursor: 'pointer',
              }}
            >
              <MessageSquare size={9} strokeWidth={2.2} />
              Fix
            </button>
          )}
        </div>
      )}
    </div>
  );
}
