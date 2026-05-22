
// Re-export shim — the real implementation lives in
// `./FileEditorPanel/FileEditorPanel.tsx` (split per spec §4.6.5 when the
// flat file crossed the 250 LOC budget). This flat path remains a stable
// import surface for existing consumers (selectors, parents like
// MainContentArea) — no behavioral change at this seam.
export { FileEditorPanel } from './FileEditorPanel/FileEditorPanel';
