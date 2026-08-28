/**
 * A SectionCard that owns exactly ONE definition file and offers two windows
 * onto it: the structured form (children) and the raw buffer. Both edit the
 * same `useDefinitionDocs` document, so switching views never loses or
 * reconciles anything — and neither view carries a Save button, the shell's
 * single ChangedBar does. No path caption: the left tree is the location
 * surface (file ↔ section isomorphism). The toggle is the shared
 * `ViewModeToggle` in SectionCard's `headerAction` — it owns the order and
 * the labels, so this card cannot name the raw view differently from the
 * prompt cards (it used to, via a `rawLabel` prop).
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewModeToggle } from '@/presentation/components/aurora';
import { SectionCard, type SectionAccent } from '@/presentation/components/ConfigEditor/aurora';
import { LineNumberedEditor } from '../../FileEditorPanel/LineNumberedEditor';
import type { DefinitionDoc } from './useDefinitionDocs';

export function DefinitionCard({
  id,
  icon,
  accent,
  title,
  description,
  doc,
  readonly,
  onRawChange,
  parseErrorLabel,
  children,
}: {
  id: string;
  icon: string;
  accent: SectionAccent;
  title: string;
  description: string;
  doc: DefinitionDoc | null;
  readonly: boolean;
  onRawChange: (text: string) => void;
  /** Parse-banner prefix — defaults to the YAML syntax message. */
  parseErrorLabel?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation('agents');
  const [yamlView, setYamlView] = useState(false);

  return (
    <SectionCard
      id={id}
      icon={icon}
      accent={accent}
      title={title}
      description={description}
      headerAction={
        <ViewModeToggle
          left="structured"
          value={yamlView ? 'raw' : 'left'}
          onChange={(next) => setYamlView(next === 'raw')}
        />
      }
    >
      {doc?.parseError && (
        <div
          className="text-xs rounded-md px-2 py-1 mb-3"
          style={{
            background: 'var(--status-error-bg, var(--bg-surface-2))',
            color: 'var(--status-error-fg, var(--text-2))',
          }}
        >
          {parseErrorLabel ?? t('overview.yamlParseError', 'YAML syntax error — the form is disabled and saving is blocked')}:{' '}
          {doc.parseError}
        </div>
      )}

      {yamlView && doc ? (
        <div className="flex flex-col gap-1.5">
          {doc.dirty && (
            <span className="text-xs font-mono" style={{ color: 'var(--text-4)' }}>
              {t('overview.unsaved', 'unsaved changes')} •
            </span>
          )}
          {/* The editor sizes itself as a flex child — a block wrapper leaves it
              height-less, so it outgrows the box and never scrolls internally. */}
          <div style={{ height: 'min(50vh, 480px)' }} className="flex flex-col min-h-0">
            <LineNumberedEditor value={doc.raw} onChange={onRawChange} disabled={readonly} />
          </div>
        </div>
      ) : (
        children
      )}
    </SectionCard>
  );
}
