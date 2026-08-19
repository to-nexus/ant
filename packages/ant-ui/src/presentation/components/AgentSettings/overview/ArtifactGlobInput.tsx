/**
 * Artifact-glob field — a structured editor for one artifact hook's glob so
 * authors never have to hand-type `*`/`**` syntax blind. Two modes per row:
 * the segment BUILDER (chips: one unit per path segment, each switchable
 * between a typed name, `*` = any name, `**` = any depth) and the RAW mono
 * input. Both edit the same string through `parseGlob ⇄ composeGlob` (a total
 * round-trip), and a live natural-language preview says what the glob means.
 * Validation authority stays `validateStopHookEntry` (@ant/shared) — the
 * builder only paints the offending segment.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, FileText, Plus, X } from 'lucide-react';
import { AuroraInput } from '@/presentation/components/ConfigEditor/aurora';
import { ViewModeButton } from '@/presentation/components/aurora';
import {
  GLOB_PRESETS,
  composeGlob,
  describeGlob,
  isSegmentValid,
  parseGlob,
  type GlobDescription,
  type GlobDirDesc,
  type GlobSegment,
} from './globBuilder';

function useGlobPreview(): (raw: string) => string | null {
  const { t } = useTranslation('agents');
  return (raw: string) => {
    const d: GlobDescription = describeGlob(raw);
    if (d.kind === 'empty') return null;
    if (d.kind === 'any-file-anywhere') {
      return t('intent.globPreviewAnyFile', 'Any file written anywhere in the artifact folder.');
    }
    const dirWord = (dir: GlobDirDesc): string =>
      dir.kind === 'literal'
        ? dir.name
        : dir.kind === 'any'
          ? t('intent.globTokenAnyFolder', '(any folder)')
          : t('intent.globTokenAnyDepth', '(any depth)');
    const location =
      d.dirs.length === 0
        ? t('intent.globLocRoot', 'in the artifact root')
        : t('intent.globLocUnder', 'under {{path}}/', { path: d.dirs.map(dirWord).join('/') });
    const f = d.file;
    const file =
      f.kind === 'any-depth'
        ? t('intent.globFileAnyDepth', 'any file at any depth')
        : f.kind === 'any-name'
          ? t('intent.globFileAny', 'a file with any name')
          : f.kind === 'exact'
            ? t('intent.globFileExact', 'exactly "{{name}}"', { name: f.name })
            : f.kind === 'ends-with'
              ? t('intent.globFileEndsWith', 'a file whose name ends with "{{suffix}}"', { suffix: f.suffix })
              : f.kind === 'starts-with'
                ? t('intent.globFileStartsWith', 'a file whose name starts with "{{prefix}}"', { prefix: f.prefix })
                : f.kind === 'starts-ends'
                  ? t('intent.globFileStartsEndsWith', 'a file named "{{prefix}}…{{suffix}}"', {
                      prefix: f.prefix,
                      suffix: f.suffix,
                    })
                  : t('intent.globFileMatching', 'a file matching "{{pattern}}"', { pattern: f.pattern });
    return t('intent.globPreview', 'Matches {{file}} {{location}}.', { file, location });
  };
}

const SEG_KIND_LABELS = { pattern: 'abc', any: '*', globstar: '**' } as const;

function SegmentChip({
  segment,
  isFile,
  disabled,
  onChange,
  onRemove,
  removable,
}: {
  segment: GlobSegment;
  isFile: boolean;
  disabled: boolean;
  onChange: (next: GlobSegment) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const { t } = useTranslation('agents');
  const invalid = !isSegmentValid(segment);
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 4px 2px 6px',
        borderRadius: 'var(--r-md)',
        border: `1px solid ${invalid ? 'var(--status-error-fg)' : 'var(--border-2)'}`,
        background: 'var(--bg-surface)',
      }}
    >
      {isFile && <FileText size={11} style={{ color: 'var(--text-4)', flexShrink: 0 }} />}
      {segment.kind === 'pattern' ? (
        <input
          value={segment.text}
          disabled={disabled}
          onChange={(e) => onChange({ kind: 'pattern', text: e.target.value })}
          placeholder={isFile ? t('intent.globSegmentFile', 'file-name') : t('intent.globSegmentFolder', 'folder')}
          style={{
            width: `${Math.max((segment.text.length || 9) + 1, 6)}ch`,
            maxWidth: 220,
            fontSize: 11.5,
            fontFamily: 'var(--font-mono)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-1)',
          }}
        />
      ) : (
        <span
          style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--violet-400)' }}
          title={
            segment.kind === 'any'
              ? t('intent.globStarHint', '* matches any characters within one path segment')
              : t('intent.globGlobstarHint', '** matches any depth — valid only as a whole segment')
          }
        >
          {segment.kind === 'any' ? '*' : '**'}
        </span>
      )}
      {/* Kind switch: typed name ↔ * ↔ ** */}
      <select
        aria-label={t('intent.globSegmentKind', 'Segment type')}
        disabled={disabled}
        value={segment.kind}
        onChange={(e) => {
          const kind = e.target.value as GlobSegment['kind'];
          onChange(
            kind === 'pattern'
              ? { kind: 'pattern', text: segment.kind === 'pattern' ? segment.text : '' }
              : kind === 'any'
                ? { kind: 'any' }
                : { kind: 'globstar' },
          );
        }}
        style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--text-4)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          width: 34,
        }}
      >
        {(Object.keys(SEG_KIND_LABELS) as Array<keyof typeof SEG_KIND_LABELS>).map((k) => (
          <option key={k} value={k}>
            {SEG_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      {removable && !disabled && (
        <button
          type="button"
          aria-label={t('intent.globRemoveSegment', 'Remove segment')}
          onClick={onRemove}
          className="inline-flex items-center justify-center h-3.5 w-3.5 rounded text-[color:var(--text-4)] hover:text-[color:var(--text-2)]"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

export function ArtifactGlobInput({
  value,
  disabled,
  hasError,
  onChange,
}: {
  value: string;
  disabled: boolean;
  hasError: boolean;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation('agents');
  const [rawMode, setRawMode] = useState(false);
  const preview = useGlobPreview();

  const segments = parseGlob(value);
  const setSegments = (next: GlobSegment[]) => onChange(composeGlob(next));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {rawMode ? (
            <AuroraInput
              value={value}
              mono
              disabled={disabled}
              hasError={hasError}
              placeholder={t('intent.hookArtifactPlaceholder', 'reports/*-weekly.md')}
              onChange={onChange}
            />
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
              {segments.map((seg, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {i > 0 && <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>/</span>}
                  <SegmentChip
                    segment={seg}
                    isFile={i === segments.length - 1}
                    disabled={disabled}
                    removable={segments.length > 1}
                    onChange={(next) => setSegments(segments.map((s, j) => (j === i ? next : s)))}
                    onRemove={() => setSegments(segments.filter((_, j) => j !== i))}
                  />
                </span>
              ))}
              {!disabled && (
                <button
                  type="button"
                  title={t('intent.globAddFolder', 'Add a folder segment before the file name')}
                  aria-label={t('intent.globAddFolder', 'Add a folder segment before the file name')}
                  onClick={() =>
                    setSegments([
                      ...segments.slice(0, -1),
                      { kind: 'pattern', text: '' },
                      segments[segments.length - 1],
                    ])
                  }
                  className="inline-flex items-center justify-center h-5 w-5 shrink-0 rounded text-[color:var(--text-4)] hover:text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition-colors"
                >
                  <Plus size={11} />
                </button>
              )}
            </div>
          )}
        </div>
        <ViewModeButton
          icon={Braces}
          label={rawMode ? t('intent.globModeBuilder', 'Builder') : t('intent.globModeRaw', 'Raw')}
          active={rawMode}
          onClick={() => setRawMode((m) => !m)}
        />
      </div>

      {value.trim().length === 0 && !disabled && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10.5, color: 'var(--text-4)' }}>
            {t('intent.globPresetsLabel', 'Examples')}
          </span>
          {GLOB_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              style={{
                fontSize: 10.5,
                fontFamily: 'var(--font-mono)',
                padding: '1px 7px',
                borderRadius: 'var(--r-pill)',
                border: '1px solid var(--border-2)',
                background: 'var(--bg-surface)',
                color: 'var(--text-3)',
                cursor: 'pointer',
              }}
            >
              {preset}
            </button>
          ))}
        </div>
      )}

      {preview(value) != null && (
        <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--text-3)' }}>{preview(value)}</p>
      )}
    </div>
  );
}
