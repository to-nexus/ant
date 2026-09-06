/**
 * ApproversEditor — the per-gate approver form (A5-2), shared by the
 * activation popover (create mode) and the ActivationSection pencil (PUT
 * mode). One mechanism: storage is ALWAYS the per-gate map; the "same for
 * all gates" checkbox is a UI convenience that mirrors the first row.
 * An empty gate row means "only I can approve" (activator-only).
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, X } from 'lucide-react';
import { DEFAULT_PIPELINE_CAPS } from '@ant/shared';
import { fetchOrgMembers } from '@/infrastructure/http/api/org';

export interface ApproverGateInfo {
  id: string;
  prompt: string;
}

const MAX_PER_GATE = DEFAULT_PIPELINE_CAPS.maxApproversPerGate;

export function ApproversEditor({
  gates,
  value,
  onChange,
}: {
  gates: ApproverGateInfo[];
  value: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
}) {
  const { t } = useTranslation('pipelines');
  const [members, setMembers] = useState<Array<{ userId: string; isSelf: boolean }>>([]);
  const [sameForAll, setSameForAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOrgMembers()
      .then(({ members }) => !cancelled && setMembers(members))
      .catch(() => !cancelled && setMembers([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const setGate = (gateId: string, list: string[]) => {
    if (sameForAll && gates.length > 0 && gateId === gates[0].id) {
      // Master row mirrors to every gate — storage stays per-gate.
      const next: Record<string, string[]> = {};
      for (const g of gates) if (list.length > 0) next[g.id] = list;
      onChange(next);
      return;
    }
    const next = { ...value };
    if (list.length > 0) next[gateId] = list;
    else delete next[gateId];
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {gates.length > 1 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-2)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={sameForAll}
            onChange={(e) => {
              setSameForAll(e.target.checked);
              if (e.target.checked && gates.length > 0) {
                const master = value[gates[0].id] ?? [];
                const next: Record<string, string[]> = {};
                for (const g of gates) if (master.length > 0) next[g.id] = master;
                onChange(next);
              }
            }}
          />
          {t('approvers.sameForAll', 'Apply the same approvers to every gate')}
        </label>
      )}
      {gates.map((gate, index) => {
        const list = value[gate.id] ?? [];
        const locked = sameForAll && index > 0;
        return (
          <div key={gate.id} style={{ opacity: locked ? 0.55 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
              <ShieldCheck size={11} style={{ color: 'var(--amber-500, #f59e0b)', flexShrink: 0, alignSelf: 'center' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {gate.prompt.slice(0, 60) || gate.id}
              </span>
              <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', flexShrink: 0 }}>{gate.id}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              {list.map((userId) => (
                <span
                  key={userId}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    padding: '2px 4px 2px 8px',
                    borderRadius: 999,
                    border: '1px solid var(--border-1)',
                    background: 'var(--bg-surface-2)',
                    color: 'var(--text-2)',
                  }}
                >
                  {userId}
                  {!locked && (
                    <button
                      aria-label={t('approvers.remove', 'Remove {{who}}', { who: userId })}
                      onClick={() => setGate(gate.id, list.filter((u) => u !== userId))}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 1, display: 'inline-flex' }}
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))}
              {!locked &&
                (list.length >= MAX_PER_GATE ? (
                  <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{list.length}/{MAX_PER_GATE}</span>
                ) : (
                  <MemberAdder
                    members={members}
                    exclude={list}
                    onAdd={(userId) => setGate(gate.id, [...list, userId])}
                  />
                ))}
            </div>
            {list.length === 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>
                {t('approvers.emptyHint', 'Left empty, only you can approve this gate.')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MemberAdder({
  members,
  exclude,
  onAdd,
}: {
  members: Array<{ userId: string; isSelf: boolean }>;
  exclude: string[];
  onAdd: (userId: string) => void;
}) {
  const { t } = useTranslation('pipelines');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const candidates = useMemo(
    () =>
      members
        .filter((m) => !exclude.includes(m.userId))
        .filter((m) => m.userId.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 8),
    [members, exclude, query],
  );

  const add = (userId: string) => {
    onAdd(userId.trim().toLowerCase());
    setQuery('');
    setOpen(false);
  };

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && candidates.length > 0) {
            e.preventDefault();
            add(candidates[0].userId);
          }
        }}
        placeholder={t('approvers.addPlaceholder', '+ search member…')}
        style={{
          fontSize: 11,
          padding: '3px 8px',
          width: 140,
          borderRadius: 999,
          border: '1px dashed var(--border-1)',
          background: 'transparent',
          color: 'var(--text-1)',
        }}
      />
      {open && candidates.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '110%',
            left: 0,
            zIndex: 40,
            minWidth: 180,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-1)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--shadow-md)',
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {candidates.map((m) => (
            <button
              key={m.userId}
              onMouseDown={(e) => {
                e.preventDefault();
                add(m.userId);
              }}
              style={{
                textAlign: 'left',
                fontSize: 11.5,
                padding: '4px 8px',
                borderRadius: 'var(--r-sm)',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-1)',
                cursor: 'pointer',
              }}
            >
              {m.userId}
              {m.isSelf && (
                <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 5 }}>{t('approvers.you', 'you')}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
