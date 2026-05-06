import * as fs from 'fs';
import * as path from 'path';
import { parseEnvLine } from './utils';

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
