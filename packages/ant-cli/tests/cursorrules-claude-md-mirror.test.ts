/**
 * `.cursorrules` ↔ `CLAUDE.md` mirror invariant
 *
 * Cursor reads `.cursorrules` and Claude Code reads `CLAUDE.md`. Both files
 * exist for the same reason — to inject the same project rules / SSOT
 * inventory into the agent. To prevent the two from drifting, we require:
 *
 *   1. Both files exist at the repo root.
 *   2. The body — defined as everything from the first `## Commands`
 *      heading to EOF — is byte-equal between the two files.
 *   3. The header above the body is allowed to differ (Anthropic's
 *      "This file provides guidance to Claude Code (claude.ai/code)…"
 *      preamble lives only in CLAUDE.md; the mirror-pointer line cites
 *      the OTHER file's name in each).
 *
 * Edit one, sync the other. The simplest sync is:
 *
 *     cp .cursorrules CLAUDE.md
 *     # then re-apply the CLAUDE.md header (4 lines):
 *     #   # CLAUDE.md
 *     #   <blank>
 *     #   This file provides guidance to Claude Code (claude.ai/code) …
 *     #   <blank>
 *     #   This file mirrors [`.cursorrules`](.cursorrules) body verbatim. …
 *
 * If this test fails, run the diff command in the failure message to see
 * exactly where the bodies diverge.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Both files live at the monorepo root, two levels above this test file.
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CURSORRULES_PATH = path.join(REPO_ROOT, '.cursorrules');
const CLAUDE_MD_PATH = path.join(REPO_ROOT, 'CLAUDE.md');

// The body is everything from the first `## Commands` heading to EOF.
// Both files MUST contain this anchor exactly once at the start of the
// shared body. Anything above it is per-file header (allowed to differ).
const BODY_ANCHOR = /^## Commands\s*$/m;

function readFileBody(absPath: string): { full: string; body: string; bodyStartLine: number } {
  const full = fs.readFileSync(absPath, 'utf8');
  const lines = full.split('\n');
  const anchorIdx = lines.findIndex(l => /^## Commands\s*$/.test(l));
  if (anchorIdx < 0) {
    throw new Error(
      `${path.basename(absPath)} does not contain the body anchor "## Commands". ` +
      `The mirror invariant requires both files to share a body that begins with this heading.`,
    );
  }
  return {
    full,
    body: lines.slice(anchorIdx).join('\n'),
    bodyStartLine: anchorIdx + 1,
  };
}

describe('.cursorrules ↔ CLAUDE.md mirror', () => {
  it('both files exist at the repo root', () => {
    expect(fs.existsSync(CURSORRULES_PATH), `${CURSORRULES_PATH} must exist`).toBe(true);
    expect(fs.existsSync(CLAUDE_MD_PATH), `${CLAUDE_MD_PATH} must exist`).toBe(true);
  });

  it('both files contain the shared body anchor "## Commands"', () => {
    const cursor = fs.readFileSync(CURSORRULES_PATH, 'utf8');
    const claude = fs.readFileSync(CLAUDE_MD_PATH, 'utf8');
    expect(BODY_ANCHOR.test(cursor)).toBe(true);
    expect(BODY_ANCHOR.test(claude)).toBe(true);
  });

  it('body (from "## Commands" to EOF) is byte-equal between the two files', () => {
    const cursor = readFileBody(CURSORRULES_PATH);
    const claude = readFileBody(CLAUDE_MD_PATH);

    if (cursor.body !== claude.body) {
      // Find the first divergent line for a useful failure message.
      const cursorLines = cursor.body.split('\n');
      const claudeLines = claude.body.split('\n');
      const minLen = Math.min(cursorLines.length, claudeLines.length);
      let firstDiff = -1;
      for (let i = 0; i < minLen; i++) {
        if (cursorLines[i] !== claudeLines[i]) {
          firstDiff = i;
          break;
        }
      }
      if (firstDiff < 0) firstDiff = minLen; // length differs only

      const cursorAbsLine = cursor.bodyStartLine + firstDiff;
      const claudeAbsLine = claude.bodyStartLine + firstDiff;

      throw new Error(
        `.cursorrules ↔ CLAUDE.md mirror body diverges.\n` +
        `\n` +
        `First divergent line:\n` +
        `  .cursorrules:${cursorAbsLine}: ${JSON.stringify(cursorLines[firstDiff] ?? '<EOF>')}\n` +
        `  CLAUDE.md:${claudeAbsLine}:    ${JSON.stringify(claudeLines[firstDiff] ?? '<EOF>')}\n` +
        `\n` +
        `Total body lines — cursor=${cursorLines.length}, claude=${claudeLines.length}.\n` +
        `\n` +
        `To resync, edit the canonical file (whichever you intended to update),\n` +
        `then run:  cp .cursorrules CLAUDE.md  and re-apply the CLAUDE.md header\n` +
        `(see the test file's top comment for the 4-line header).\n` +
        `\n` +
        `Or run from repo root to inspect the full diff:\n` +
        `  diff <(awk '/^## Commands/{p=1}p' .cursorrules) <(awk '/^## Commands/{p=1}p' CLAUDE.md)`,
      );
    }
    expect(cursor.body).toBe(claude.body);
  });

  it('CLAUDE.md header preserves the Anthropic-required preamble', () => {
    // Anthropic's CLAUDE.md convention: the file should declare its
    // purpose for Claude Code in the first non-title paragraph. We don't
    // pin the exact wording but require the marker phrase so a future
    // header rewrite doesn't accidentally drop it.
    const claude = fs.readFileSync(CLAUDE_MD_PATH, 'utf8');
    expect(claude).toMatch(/Claude Code/);
    expect(claude).toMatch(/^# CLAUDE\.md/m);
  });

  it('.cursorrules header preserves its title', () => {
    const cursor = fs.readFileSync(CURSORRULES_PATH, 'utf8');
    expect(cursor).toMatch(/^# Ant CLI Project Rules/m);
  });

  it('both headers contain a mirror-pointer line citing the other file', () => {
    const cursor = fs.readFileSync(CURSORRULES_PATH, 'utf8');
    const claude = fs.readFileSync(CLAUDE_MD_PATH, 'utf8');
    expect(cursor).toMatch(/mirrors\s+\[`CLAUDE\.md`\]/);
    expect(claude).toMatch(/mirrors\s+\[`\.cursorrules`\]/);
  });
});
