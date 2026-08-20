/**
 * Artifact-glob field — a structured editor for one artifact hook's glob so
 * authors never have to hand-type `*`/`**` syntax blind. It mirrors the
 * action row's shape ([picker] [name]) on purpose: ONE location picker
 * (artifact root / a folder path / `*` / `**`) plus ONE file-name field, with
 * a nested directory typed as a whole path in the single folder field rather
 * than one control per level. Root is an explicit option in that picker — not
 * "remove every folder chip".
 *
 * Raw mode (owned by the row, passed in) swaps the parts for the mono string.
 * Both edit the same value through `splitGlob ⇄ joinGlob`, and a live
 * natural-language preview says what the glob means. Validation authority
 * stays `validateStopHookEntry` (@ant/shared) — the fields only paint red.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderTree } from 'lucide-react';
import { AuroraInput, AuroraSelect, FieldHint } from '@/presentation/components/ConfigEditor/aurora';
import {
  GLOB_PRESETS,
  describeGlob,
  isDirPathValid,
  isFileNameValid,
  joinGlob,
  splitGlob,
  type GlobDescription,
  type GlobDirDesc,
  type GlobLocationKind,
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

/**
 * Does the glob carry a directory part? If it does, an empty file name leaves
 * it ending in '/' — invalid. A `folder` location whose path is still empty
 * composes as root, so it does not count.
 */
function hasDirPart(location: GlobLocationKind, dir: string): boolean {
  if (location === 'root') return false;
  return location !== 'folder' || dir !== '';
}

export function ArtifactGlobInput({
  value,
  disabled,
  hasError,
  rawMode,
  onChange,
}: {
  value: string;
  disabled: boolean;
  hasError: boolean;
  /** Row-owned mode: the mono string instead of the parts. */
  rawMode: boolean;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation('agents');
  const preview = useGlobPreview();

  const parts = splitGlob(value);
  // A folder location whose path is still empty composes as root, so the
  // picker would snap back to Root mid-typing. Pin the author's choice until
  // they pick another one.
  const [pinnedFolder, setPinnedFolder] = useState(false);
  const location: GlobLocationKind =
    pinnedFolder && parts.location === 'root' ? 'folder' : parts.location;
  const emit = (next: Partial<{ location: GlobLocationKind; dir: string; file: string }>) =>
    onChange(joinGlob({ location, dir: parts.dir, file: parts.file, ...next }));

  const locationOptions = [
    { value: 'root', label: t('intent.globLocOptRoot', 'Artifact root') },
    { value: 'folder', label: t('intent.globLocOptFolder', 'Folder…') },
    { value: 'any', label: t('intent.globLocOptAny', 'Any one folder (*)') },
    { value: 'anyDepth', label: t('intent.globLocOptAnyDepth', 'Any depth (**)') },
  ];

  const separator = (
    <span
      aria-hidden
      style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', lineHeight: '36px' }}
    >
      /
    </span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <div style={{ flex: '0 1 190px', minWidth: 0 }}>
            <AuroraSelect
              value={location}
              disabled={disabled}
              options={locationOptions}
              onChange={(v) => {
                const next = v as GlobLocationKind;
                setPinnedFolder(next === 'folder');
                emit({
                  location: next,
                  dir: next === 'folder' ? parts.dir : '',
                  // A token location with no name yet would compose the
                  // trailing-slash `**/`; seed the name so every pick is a
                  // valid glob on its own.
                  file:
                    hasDirPart(next, parts.dir) && parts.file === '' ? '*' : parts.file,
                });
              }}
            />
          </div>
          {/* The path fields wrap as ONE unit, so a narrow card never splits `dir / file`. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 200px', minWidth: 0 }}>
            {location === 'folder' && (
              <>
                <div style={{ flex: '1.4 1 0', minWidth: 0 }}>
                  <AuroraInput
                    value={parts.dir}
                    mono
                    disabled={disabled}
                    hasError={!isDirPathValid(parts.dir)}
                    prefix={<FolderTree size={12} />}
                    placeholder={t('intent.globDirPlaceholder', 'reports/weekly')}
                    onChange={(dir) => emit({ dir })}
                  />
                </div>
                {separator}
              </>
            )}
            {(location === 'any' || location === 'anyDepth') && separator}
            <div style={{ flex: '1 1 0', minWidth: 0 }}>
              <AuroraInput
                value={parts.file}
                mono
                disabled={disabled}
                // Empty is "not typed yet" until a directory part exists —
                // after that it would leave the glob ending in '/'.
                hasError={
                  !isFileNameValid(parts.file) ||
                  (parts.file === '' && hasDirPart(location, parts.dir))
                }
                placeholder={t('intent.globFilePlaceholder', '*.md')}
                onChange={(file) => emit({ file })}
              />
            </div>
          </div>
        </div>
      )}

      {!rawMode && location === 'folder' && (
        <FieldHint tone="muted">
          {t('intent.globDirHint', 'One field for the whole path — nest it with "/" (reports/weekly/kr).')}
        </FieldHint>
      )}

      {value.trim().length === 0 && !disabled && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10.5, color: 'var(--text-4)' }}>
            {t('intent.globPresetsLabel', 'Examples')}
          </span>
          {GLOB_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setPinnedFolder(false);
                onChange(preset);
              }}
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
        <FieldHint>{preview(value)}</FieldHint>
      )}
    </div>
  );
}
