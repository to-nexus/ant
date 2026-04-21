/**
 * Shared clarify types — single source of truth.
 *
 * Prior history: `planner/graph/plan/nodes/generate/clarify.ts` redefined
 * `ClarifyBlock` locally with a narrower shape (`options: string[]`),
 * causing two incompatible interfaces to coexist. All consumers now import
 * from here.
 */

export type ClarifyOption = string | {
  label: string;
  value: string;
  imagePath?: string;
  thumbnailPath?: string;
};

export interface ClarifyBlock {
  question: string;
  /**
   * `string` entries are rendered as plain choice labels.
   * Object entries allow richer presentation (image thumbnails, distinct
   * display labels vs. values returned to the backend).
   */
  options: ClarifyOption[];
  allowFreeText?: boolean;
  allowRegenerate?: boolean;
}
