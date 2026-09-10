/**
 * The agent level of the universal card surface — one chip grid per scope
 * group (personal / organization / built-in).
 *
 * Groups are open by default and collapse locally; the state is not persisted,
 * because a picker's disclosure is a glance-scoped decision, unlike the settings
 * rail's tree state. Scope labels are the settings rail's own
 * (`agents:tree.scope.*`) rather than a second copy in the actions namespace —
 * one agent must not be filed under two different words.
 */

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IntentChipGrid } from './ActionChipGrid';
import { CARD_PREF, GRID_GAP, MAX_COLS } from './chipGridLayout';
import type { UniversalActionSurface } from './useUniversalActionSurface';

export function AgentScopeGroups({
  surface,
  onSelect,
}: {
  surface: UniversalActionSurface;
  onSelect: (agentId: string) => void;
}) {
  const { t } = useTranslation('actions');
  const { t: tAgents } = useTranslation('agents');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // One track width for every group, so the headers and the cards of different
  // groups share a left edge instead of each group centring on its own count.
  const cols = Math.min(
    Math.max(1, ...surface.agentGroups.map((g) => g.agents.length)),
    MAX_COLS,
  );
  const groupWidth = { width: '100%', maxWidth: cols * CARD_PREF + (cols - 1) * GRID_GAP, marginInline: 'auto' };

  return (
    <div className="flex flex-col items-center w-full gap-5">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>
        {t('universal.pickAgentTitle', { defaultValue: 'Which agent should work on this?' })}
      </h2>
      {surface.agentGroups.map((group) => {
        const isCollapsed = collapsed.has(group.scope);
        return (
          <div key={group.scope} style={groupWidth}>
            <button
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(group.scope)) next.add(group.scope);
                  return next;
                })
              }
              aria-expanded={!isCollapsed}
              className="flex items-center gap-1.5 mb-2.5 text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-3)' }}
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                strokeWidth={2.5}
              />
              {tAgents(`tree.scope.${group.scope}`, group.scope)}
              <span style={{ color: 'var(--text-4)' }}>{group.agents.length}</span>
            </button>
            {!isCollapsed && (
              <IntentChipGrid
                items={surface.agentChipItems(group.agents)}
                onSelect={onSelect}
                columnCount={cols}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
