import * as fs from 'fs';
import * as path from 'path';
import { parseEnvLine } from './utils';
import {
  frameworkTogglePrefix,
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
