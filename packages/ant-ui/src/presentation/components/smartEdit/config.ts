/**
 * Smart Edit Configuration Registry
 *
 * Defines which files get a simplified "smart edit" UI instead of the raw
 * text editor.  Each config entry specifies how to convert between the
 * file's native format (e.g. JSON) and a flat, line-per-value representation
 * that is easier for users to work with.
 *
 * To support a new file type, append an entry to SMART_EDIT_CONFIGS.
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SmartEditGroup {
  key: string | null;
  label?: string;
  /** i18n key resolved by the editor component via t() */
  placeholder?: string;
  values: string[];
  /** undefined = unlimited entries, 1 = single input (hides add button) */
  maxValues?: number;
}

export type DeserializeResult =
  | {
      ok: true;
      groups: SmartEditGroup[];
      /** Original fields not managed by smart edit – restored on serialize */
      preserved: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
    };

export interface SmartEditConfig {
  fileMatch: (filePath: string) => boolean;
  /** Produce the canonical empty content for this file type (Reset button) */
  createEmpty: () => string;
  deserialize: (content: string) => DeserializeResult;
  serialize: (groups: SmartEditGroup[], preserved: Record<string, unknown>) => string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Registry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const SMART_EDIT_CONFIGS: SmartEditConfig[] = [
  // ── figma.json ─────────────────────────────────────────
  {
    fileMatch: (path) => path.endsWith('figma.json'),

    createEmpty: () => JSON.stringify({ file: null }, null, 2) + '\n',

    deserialize: (content) => {
      try {
        const data = JSON.parse(content);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { file, files: _legacyFiles, ...preserved } = data;
        const value = typeof file === 'string' && file ? file
          : (Array.isArray(_legacyFiles) && _legacyFiles[0]) ? String(_legacyFiles[0])
          : null;
        return {
          ok: true,
          groups: [
            {
              key: null,
              placeholder: 'editor.smartPlaceholder.figma',
              values: value ? [value] : [],
              maxValues: 1,
            },
          ],
          preserved,
        };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },

    serialize: (groups, preserved) => {
      const value = groups[0]?.values[0]?.trim() || null;
      return JSON.stringify({ ...preserved, file: value }, null, 2) + '\n';
    },
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Lookup
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getSmartEditConfig(filePath: string): SmartEditConfig | null {
  return SMART_EDIT_CONFIGS.find((c) => c.fileMatch(filePath)) ?? null;
}
