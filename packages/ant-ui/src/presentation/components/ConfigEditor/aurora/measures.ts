/**
 * Readable prose measure for settings copy, in px.
 *
 * A card description and a field hint are the SAME role — explanatory prose —
 * so they must wrap at the same width. They had drifted apart (a description
 * capped at 560, a hint inheriting whatever width the control group above it
 * needed), which reads as two different text columns stacked inside one card.
 * At 11.5–12px this is ~90 Latin / ~45 Korean characters per line.
 */
export const PROSE_MEASURE = 560;
