import * as fs from 'fs';
import * as path from 'path';
import { parseEnvLine } from './utils';
import { ServiceConnection } from '../../../../../../../core/ports/portRegistry';
import {
  frameworkTogglePrefix,
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
      const prevIdx = keyIdx - 1;
      if (prevIdx >= 0 && parseAnnotationLine(lines[prevIdx])) {
        lines[prevIdx] = annotationLine; // replace existing annotation in place
      } else {
        lines.splice(keyIdx, 0, annotationLine); // insert above the KEY line
      }
      fs.writeFileSync(envExamplePath, lines.join('\n'), 'utf-8');
    }
  }

  if (conn.category === 'business' && conn.virtualization) {
    setToggleDefaultIfAbsent(envExamplePath, conn.virtualization.toggleEnvVar, framework);
  }
}

/**
 * Mirror a connection's runtime value into `.env` per the §5 value invariant:
 * `infrastructure` → its localhost/compose value, virtualized `business`
 * (incl. self / ant-project) → empty. Business connections also persist their
 * virtualization toggle's active value (the panel toggle is deferred to Save).
 */
export function mirrorConnectionToEnv(
  envPath: string,
  conn: ServiceConnection,
  framework?: DeployFramework,
): void {
  const mirrorValue = conn.category === 'infrastructure' ? conn.value || '' : '';
  setEnvValue(envPath, conn.envVar, mirrorValue);

  if (conn.category === 'business' && conn.virtualization) {
    // Write the chosen toggle value, not just a default — Save is the single
    // place the panel toggle lands, so the active state must be persisted.
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
  const keyIdx = findKeyLineIndex(lines, conn.envVar);
  if (keyIdx <= 0) return;
  const prevIdx = keyIdx - 1;
  if (parseAnnotationLine(lines[prevIdx])) {
    lines.splice(prevIdx, 1);
    fs.writeFileSync(envExamplePath, lines.join('\n'), 'utf-8');
  }
}
