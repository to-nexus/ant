import { checkMinInterval, getNextFires } from '../../core/pipelines/cron';
import { EXIT, type CliResult } from './commands';

export interface PreviewFiresJson {
  ok: boolean;
  error?: string;
  fires: string[];
}

/** The `POST /definitions/pipelines/preview-fires` body, computed locally — same parser, same interval cap. */
export function runPreviewFires(cron: string, tz?: string): CliResult<PreviewFiresJson> {
  const preview = getNextFires(cron, tz, 5);
  if (!preview.ok) {
    return { exitCode: EXIT.FINDINGS, lines: [`error: ${preview.error}`], json: { ok: false, error: preview.error, fires: [] } };
  }
  const intervalError = checkMinInterval(cron, tz);
  const json: PreviewFiresJson = { ok: !intervalError, error: intervalError ?? undefined, fires: preview.nextFires };
  const lines = preview.nextFires.map((f) => `fire: ${f}`);
  if (intervalError) lines.push(`error: ${intervalError}`);
  return { exitCode: intervalError ? EXIT.FINDINGS : EXIT.CLEAN, lines, json };
}
