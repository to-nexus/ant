import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createOutputStreamer,
  STREAM_COALESCE_MS,
} from '../../src/agents/common/tool/handlers/runCommand';
import { createNoopChatStatusReporter } from '../../src/agents/common/tool/chatStatusAdapter';

function makeReporter() {
  const noop = createNoopChatStatusReporter();
  const stream = vi.fn<(command: string, output: string) => Promise<void>>(async () => {});
  return {
    ...noop,
    streamCommandOutput: stream,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createOutputStreamer', () => {
  it('coalesces rapid schedules into one emit per window', () => {
    const reporter = makeReporter();
    let buffer = '';
    const s = createOutputStreamer(reporter, 'pnpm build', () => buffer);

    buffer = 'a'; s.schedule();
    buffer = 'ab'; s.schedule();
    buffer = 'abc'; s.schedule();
    expect(reporter.streamCommandOutput).not.toHaveBeenCalled();

    vi.advanceTimersByTime(STREAM_COALESCE_MS);
    expect(reporter.streamCommandOutput).toHaveBeenCalledTimes(1);
    expect(reporter.streamCommandOutput).toHaveBeenLastCalledWith('pnpm build', 'abc');
  });

  it('flush emits immediately and cancels any pending timer', () => {
    const reporter = makeReporter();
    let buffer = 'start';
    const s = createOutputStreamer(reporter, 'x', () => buffer);

    s.schedule();
    buffer = 'start + more';
    s.flush();

    expect(reporter.streamCommandOutput).toHaveBeenCalledTimes(1);
    expect(reporter.streamCommandOutput).toHaveBeenLastCalledWith('x', 'start + more');

    vi.advanceTimersByTime(STREAM_COALESCE_MS * 2);
    expect(reporter.streamCommandOutput).toHaveBeenCalledTimes(1);
  });

  it('stops emitting after flush (late schedule is a no-op)', () => {
    const reporter = makeReporter();
    let buffer = 'first';
    const s = createOutputStreamer(reporter, 'x', () => buffer);
    s.flush();
    expect(reporter.streamCommandOutput).toHaveBeenCalledTimes(1);

    buffer = 'late';
    s.schedule();
    vi.advanceTimersByTime(STREAM_COALESCE_MS * 2);
    expect(reporter.streamCommandOutput).toHaveBeenCalledTimes(1);
  });

  it('does not emit twice for identical snapshots', () => {
    const reporter = makeReporter();
    const s = createOutputStreamer(reporter, 'x', () => 'same');

    s.schedule();
    vi.advanceTimersByTime(STREAM_COALESCE_MS);
    expect(reporter.streamCommandOutput).toHaveBeenCalledTimes(1);

    s.schedule();
    vi.advanceTimersByTime(STREAM_COALESCE_MS);
    expect(reporter.streamCommandOutput).toHaveBeenCalledTimes(1);
  });
});
