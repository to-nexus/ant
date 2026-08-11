/**
 * JSON-line logger. In stdio mode stdout carries the JSON-RPC channel, so
 * ALL log lines must go to stderr — call `useStderr()` before connecting the
 * stdio transport.
 */

let sink: NodeJS.WriteStream = process.stdout;

export function useStderr(): void {
  sink = process.stderr;
}

export function log(evt: string, fields: Record<string, unknown> = {}): void {
  sink.write(JSON.stringify({ ts: new Date().toISOString(), evt, ...fields }) + '\n');
}
