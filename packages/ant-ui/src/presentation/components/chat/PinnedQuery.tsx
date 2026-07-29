/**
 * PinnedQuery - Displays a user query pinned at the top
 * Similar to Cursor/Copilot UX where the current query stays visible
 *
 * Features:
 * - Fixed height by default (truncated with line-clamp)
 * - Expands on hover to show the full prompt, text stays selectable
 * - A jump button appears on hover / focus; pressing it scrolls the history
 *   back to that message (and ends the hover, so the pin re-collapses)
 * - Uses absolute positioning to avoid layout feedback loops with Virtuoso
 * - Always mounted, visibility controlled via CSS (no mount/unmount flicker)
 */

import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpToLine } from 'lucide-react';
import type { ActionMetadata } from '@ant/shared';
import { ActionMetadataBadges } from './ActionMetadataBadges';

/**
 * Collapsed height of the pin bar, in px.
 *
 * Single owner for the two places that must agree with it: the pin hides the
 * top of the scroll surface, so this is both the inset that decides when a
 * prompt counts as "no longer visible" and the offset the jump scrolls by so
 * the target lands below the bar. Must track the collapsed layout below
 * (`py-3` + a 22px icon row + the 1px bottom border).
 */
export const PIN_COLLAPSED_HEIGHT_PX = 48;

export interface PinnedQueryData {
  content: string;
  actionMetadata?: ActionMetadata;
  /** Identity of the pinned turn — also the jump target. */
  turnId: string;
}

interface PinnedQueryProps {
  query: PinnedQueryData | null;
  /** Scroll the history to the pinned message. */
  onJump?: () => void;
}

export const PinnedQuery = forwardRef<HTMLDivElement, PinnedQueryProps>(
  function PinnedQuery({ query, onJump }, ref) {
    const { t } = useTranslation('chat');
    const [isHovered, setIsHovered] = useState(false);
    const [isFocusVisible, setIsFocusVisible] = useState(false);

    const isActive = !!query;
    const hasBadges = query?.actionMetadata && Object.keys(query.actionMetadata).length > 0;
    const canJump = isActive && !!onJump;
    const showJump = canJump && (isHovered || isFocusVisible);

    return (
      <div
        ref={ref}
        className={`
        absolute top-0 left-0 right-0 z-10
        backdrop-blur-sm
        px-8 py-3
        transition-[opacity,transform] duration-200
        ${isActive ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-2 pointer-events-none'}
      `}
        style={{
          background: 'oklch(from var(--bg-surface) l c h / 0.94)',
          borderBottom: '1px solid var(--border-1)',
          boxShadow: isHovered ? 'var(--shadow-lg)' : 'none',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* 2px Aurora gradient top accent strip */}
        <div
          aria-hidden="true"
          className="absolute top-0 left-0 right-0 transition-opacity duration-200"
          style={{
            height: '2px',
            background: 'var(--gradient-aurora)',
            opacity: isHovered ? 1 : 0.7,
          }}
        />

        {canJump && (
          <button
            type="button"
            title={t('pinnedQuery.jumpToMessage')}
            aria-label={t('pinnedQuery.jumpToMessage')}
            onClick={(e) => {
              e.stopPropagation();
              onJump?.();
            }}
            onFocus={(e) => setIsFocusVisible(e.currentTarget.matches(':focus-visible'))}
            onBlur={() => setIsFocusVisible(false)}
            className="absolute right-3 top-2.5 flex items-center justify-center rounded transition-opacity duration-150"
            style={{
              width: 22,
              height: 22,
              opacity: showJump ? 1 : 0,
              // An opacity-0 button still hit-tests, and this one sits over
              // the scroll surface — keep it inert until it is actually shown.
              // Tab focus is unaffected, and focusing it flips showJump.
              pointerEvents: showJump ? 'auto' : 'none',
              color: isHovered ? 'var(--text-1)' : 'var(--text-3)',
              // Inset ring: the button sits against the pin's right edge.
              outline: isFocusVisible ? '2px solid var(--violet-400)' : 'none',
              outlineOffset: '-2px',
            }}
          >
            <ArrowUpToLine className="w-3.5 h-3.5" />
          </button>
        )}

        <div className="flex gap-3 items-start">
          {/* User Icon — 22px gradient circle */}
          <div className="flex-shrink-0 mt-0.5">
            <div
              className="rounded-full flex items-center justify-center"
              style={{
                width: 22,
                height: 22,
                background: 'var(--gradient-aurora)',
                boxShadow: 'var(--shadow-glow-aurora)',
              }}
            >
              <svg
                className="w-4 h-4"
                style={{ color: 'var(--text-on-brand)' }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
          </div>

          {/* Query Content + Badges */}
          <div className="flex-1 min-w-0" style={{ paddingRight: canJump ? 24 : 0 }}>
            {isHovered && hasBadges && (
              <div className="-ml-3 mb-1">
                <ActionMetadataBadges metadata={query.actionMetadata} readOnly />
              </div>
            )}
            <div
              className={`
              text-sm font-medium
              transition-all duration-200 ease-in-out
              ${isHovered ? 'max-h-[50vh] overflow-y-auto whitespace-pre-wrap' : 'truncate'}
            `}
              style={{ color: 'var(--text-1)' }}
            >
              {query?.content}
            </div>
          </div>
        </div>
      </div>
    );
  },
);
