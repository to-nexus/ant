import * as fs from 'fs';
import * as path from 'path';
import { parseEnvLine } from './utils';
import { findNextEnvLine } from './parseEnvAnnotations';
import { ServiceConnection } from '../../../../../../../core/ports/portRegistry';
import {
  deriveToggleVar,
  frameworkTogglePrefix,
  isMockToggleVar,
  parseAnnotationLine,
  resolutionToModifier,
  serializeAnnotationLine,
  type DeployFramework,
} from '../../../../../../../core/prompt/builder/serviceVirtualization/connectionModel';

/**
 * Set a single `KEY=value` entry in the project `.env` file. Companion to
 * `overrideWithEnvFile` (the read side): read computes
 * `virtualization.active`, this writer commits the toggle when the user
 * flips the UI Real / Virtualized switch.
 *
 * Behaviour:
 *   - file missing → create with the single line
 *   - key absent  → append (preceded by a single newline if needed)
 *   - key present → replace IN-PLACE preserving surrounding lines (comments,
 *                   ordering, other vars) so manual edits aren't clobbered
 *
 * The function is intentionally stupid about quoting — boolean strings
 * `'true'` / `'false'` round-trip through `parseEnvLine` losslessly, and
 * that's the only payload the toggle endpoint emits today.
 */
export function setEnvValue(
  envFilePath: string,
  key: string,
  value: string,
): void {
  const newLine = `${key}=${value}`;

  if (!fs.existsSync(envFilePath)) {
    const dir = path.dirname(envFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(envFilePath, `${newLine}\n`, 'utf-8');
    return;
  }

  const original = fs.readFileSync(envFilePath, 'utf-8');
  const lines = original.split('\n');
  let replaced = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [k] = parseEnvLine(trimmed);
    if (k === key) {
      lines[i] = newLine;
      replaced = true;
      break;
    }
  }

  let next: string;
  if (replaced) {
    next = lines.join('\n');
  } else {
    const trailingNewline = original.endsWith('\n') ? '' : '\n';
    next = `${original}${trailingNewline}${newLine}\n`;
  }

  fs.writeFileSync(envFilePath, next, 'utf-8');
}

/** First candidate (in preference order) already declared in the `.env` file. */
function findExistingKey(envFilePath: string, candidates: string[]): string | undefined {
  const present = new Set<string>();
  for (const line of fs.readFileSync(envFilePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [k] = parseEnvLine(trimmed);
    if (k) present.add(k);
  }
  return candidates.find(c => present.has(c));
}

/**
 * Framework-prefix-aware companion to `setEnvValue` for the mock-toggle var.
 *
 * The toggle is client-visible, so a bundled frontend reads it under its
 * framework prefix (`NEXT_PUBLIC_` / `VITE_` / `REACT_APP_`) while a server
 * consumer reads the bare name. A bare-only write (the previous behaviour)
 * appends an orphan `USE_MOCK_X` next to an existing `NEXT_PUBLIC_USE_MOCK_X`,
 * which `resolveActivation` then shadows (prefix scanned first) — the toggle
 * silently fails to stick.
 *
 * Strategy: update whichever variant already exists IN PLACE (prefixed first),
 * and only create the framework-preferred name when none exists. Reuses
 * `setEnvValue` for the write — no second writer. Returns the key written.
 */
export function setToggleEnvValue(
  envFilePath: string,
  bareToggle: string,
  framework: DeployFramework | undefined,
  value: string,
): string {
  // `bareToggle` is already `USE_MOCK_<NAME>`; just apply the client prefix.
  const prefix = frameworkTogglePrefix(framework);
  // Prefer the framework-prefixed name; fall back to bare.
  const preference = prefix ? [`${prefix}${bareToggle}`, bareToggle] : [bareToggle];

  const existing = fs.existsSync(envFilePath)
    ? findExistingKey(envFilePath, preference)
    : undefined;
  const targetKey = existing ?? preference[0];

  setEnvValue(envFilePath, targetKey, value);
  return targetKey;
}

/** Index of the `KEY=` line for `envVar` (skips blanks/comments), or -1. */
function findKeyLineIndex(lines: string[], envVar: string): number {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [k] = parseEnvLine(trimmed);
    if (k === envVar) return i;
  }
  return -1;
}

/**
 * Indices of every `@connection` line that binds to `envVar`, using the SAME
 * binding rule the detector reads with — `findNextEnvLine` (the read SSOT):
 * an annotation binds to the next `KEY=` line after it, skipping blanks AND
 * comments. The write side must locate the existing annotation the same way it
 * was read; assuming strict adjacency (`keyIdx - 1`) misses an annotation that
 * the code job separated from its KEY with explanatory comment lines, causing a
 * duplicate annotation to be inserted instead of an in-place replace.
 *
 * Returns indices in file order; usually one, but more if a prior buggy write
 * left duplicates (callers collapse them).
 */
function annotationIndicesBoundTo(lines: string[], envVar: string): number[] {
  const indices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!parseAnnotationLine(lines[i])) continue;
    const next = findNextEnvLine(lines, i + 1);
    if (!next) continue;
    const [k] = parseEnvLine(next);
    if (k === envVar) indices.push(i);
  }
  return indices;
}

/**
 * Write `bareToggle=true` (framework-aware) ONLY when no variant is already
 * present — idempotent default. Shared by the `.env.example` annotation writer
 * and the spawn-time `.env` backfill that replaced `mockToggleDefaults`, so
 * default-ON lives in the file (one SSOT), not in a runtime injection slot.
 */
export function setToggleDefaultIfAbsent(
  envFilePath: string,
  bareToggle: string,
  framework: DeployFramework | undefined,
): void {
  const prefix = frameworkTogglePrefix(framework);
  const candidates = prefix ? [`${prefix}${bareToggle}`, bareToggle] : [bareToggle];
  const present =
    fs.existsSync(envFilePath) && findExistingKey(envFilePath, candidates) !== undefined;
  if (!present) setToggleEnvValue(envFilePath, bareToggle, framework, 'true');
}

/**
 * Deterministically upsert a connection's `@connection` annotation in
 * `.env.example` — the write side of the panel Save flow (replaces the
 * Fix → LLM code-job round-trip).
 *
 * Surgical line-model (same discipline as `setEnvValue`):
 *   - annotation line above the KEY → replace in place
 *   - KEY present without annotation → insert annotation above it
 *   - KEY absent → append annotation + KEY pair
 * Every other line / comment / ordering is preserved. A business connection
 * additionally gets its mock-toggle default line when absent.
 */
export function upsertConnectionAnnotation(
  envExamplePath: string,
  conn: ServiceConnection,
  framework?: DeployFramework,
): void {
  const annotationLine = serializeAnnotationLine(
    conn.category,
    conn.id,
    resolutionToModifier(conn.resolution),
  );

  if (!fs.existsSync(envExamplePath)) {
    const dir = path.dirname(envExamplePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(envExamplePath, `${annotationLine}\n${conn.envVar}=\n`, 'utf-8');
  } else {
    const original = fs.readFileSync(envExamplePath, 'utf-8');
    const lines = original.split('\n');
    const keyIdx = findKeyLineIndex(lines, conn.envVar);

    if (keyIdx === -1) {
      const sep = original === '' || original.endsWith('\n') ? '' : '\n';
      fs.writeFileSync(
        envExamplePath,
        `${original}${sep}${annotationLine}\n${conn.envVar}=\n`,
        'utf-8',
      );
    } else {
      // Locate the existing annotation with the read-side binding rule
      // (comment-tolerant), not strict `keyIdx - 1` adjacency.
      const bound = annotationIndicesBoundTo(lines, conn.envVar);
      if (bound.length > 0) {
        lines[bound[0]] = annotationLine; // replace in place (preserves position)
        // Collapse any duplicates a prior strict-adjacency write left behind.
        for (let j = bound.length - 1; j >= 1; j--) lines.splice(bound[j], 1);
      } else {
        lines.splice(keyIdx, 0, annotationLine); // KEY present, no annotation → insert above
      }
      fs.writeFileSync(envExamplePath, lines.join('\n'), 'utf-8');
    }
  }

  if (conn.category === 'business' && conn.virtualization) {
    setToggleDefaultIfAbsent(envExamplePath, conn.virtualization.toggleEnvVar, framework);
  }
}

/**
 * Mirror a connection's runtime value + toggle into `.env` — the value SSOT.
 *
 * `.env` owns the actual runtime value for EVERY category (the app reads this
 * file; `.env.example` stays value-less for secret safety). We write
 * `conn.value` verbatim — the user-entered value from the panel, or a
 * detector/materializer default. Nothing is fabricated: a connection with no
 * value (greenfield business / ant-project) still writes empty. Business
 * connections additionally persist their virtualization toggle's active value
 * (Save is the single place the panel toggle lands).
 */
export function mirrorConnectionToEnv(
  envPath: string,
  conn: ServiceConnection,
  framework?: DeployFramework,
): void {
  setEnvValue(envPath, conn.envVar, conn.value || '');

  if (conn.category === 'business' && conn.virtualization) {
    setToggleEnvValue(
      envPath,
      conn.virtualization.toggleEnvVar,
      framework,
      conn.virtualization.active ? 'true' : 'false',
    );
  }
}

/**
 * Remove a connection's `@connection` annotation line from `.env.example`.
 * The KEY line is left intact (it may be plain config owned by the user /
 * code); only registry membership is dropped.
 */
export function removeConnectionAnnotation(
  envExamplePath: string,
  conn: ServiceConnection,
): void {
  if (!fs.existsSync(envExamplePath)) return;
  const lines = fs.readFileSync(envExamplePath, 'utf-8').split('\n');
  // Same comment-tolerant binding rule as the read/upsert side; removes every
  // annotation bound to this KEY (collapses any leftover duplicates too).
  const bound = annotationIndicesBoundTo(lines, conn.envVar);
  if (bound.length === 0) return;
  for (let j = bound.length - 1; j >= 0; j--) lines.splice(bound[j], 1);
  fs.writeFileSync(envExamplePath, lines.join('\n'), 'utf-8');
}

/**
 * Delete a `KEY=...` line from `.env` (skips blanks/comments; preserves order).
 * Used by the explicit connection-removal flow — the only place a `.env` key is
 * deleted, because there the removed connection's `envVar` is known. Blind
 * structure sync never deletes (a `.env` key absent from `.env.example` may be
 * plain user config). No-op when the key or file is absent.
 */
export function removeEnvKey(envPath: string, key: string): void {
  if (!fs.existsSync(envPath)) return;
  const original = fs.readFileSync(envPath, 'utf-8');
  const lines = original.split('\n');
  const idx = findKeyLineIndex(lines, key);
  if (idx === -1) return;
  lines.splice(idx, 1);
  fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
}

/**
 * Structure sync: `.env.example` (structure SSOT) → `.env` (value SSOT).
 *
 * Ensures every connection KEY declared in `.env.example` exists in `.env`
 * WITHOUT touching values already present — `.env` owns the value/toggle SSOT:
 *   - value key absent in `.env`  → add empty (business/greenfield correct;
 *     infra localhost defaults are authored once at gen-code, then preserved)
 *   - business toggle key absent  → add mock-on default (`setToggleDefaultIfAbsent`)
 *   - existing keys               → preserved verbatim (never clobbered)
 *
 * Deletion is intentionally NOT performed here: a `.env` key absent from
 * `.env.example` is indistinguishable from plain user config. Explicit
 * connection removal (which knows the `envVar`) drops the `.env` key via
 * `removeEnvKey`. Called at gen-code completion and on panel annotation change.
 */
export function syncEnvStructureFromExample(
  envExamplePath: string,
  envPath: string,
  framework?: DeployFramework,
): void {
  if (!fs.existsSync(envExamplePath)) return;
  const lines = fs.readFileSync(envExamplePath, 'utf-8').split('\n');

  const envKeys = new Set<string>();
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [k] = parseEnvLine(trimmed);
      if (k) envKeys.add(k);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const annotation = parseAnnotationLine(lines[i]);
    if (!annotation) continue;
    const next = findNextEnvLine(lines, i + 1);
    if (!next) continue;
    const [envVar] = parseEnvLine(next);
    if (!envVar || isMockToggleVar(envVar)) continue;

    if (!envKeys.has(envVar)) {
      setEnvValue(envPath, envVar, '');
      envKeys.add(envVar);
    }
    if (annotation.category === 'business') {
      setToggleDefaultIfAbsent(envPath, deriveToggleVar(annotation.name), framework);
    }
  }
}
