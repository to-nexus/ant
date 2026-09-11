/**
 * `useUploadStatus` — the one owner of "what is this upload doing, and how did
 * it end", shared by the artifacts tree and both definition screens.
 *
 * The transitions pinned here are the ones whose absence made a definition
 * upload silent: a completion frame that actually appears, a failure that does
 * NOT leave a half-finished card behind, and a refusal line that shows up
 * without a card at all.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, create } from 'react-test-renderer';
import { useUploadStatus, type UploadStatusApi } from '../../src/application/hooks/ui/useUploadStatus';

function render(): { api: () => UploadStatusApi; unmount: () => void } {
  let latest!: UploadStatusApi;
  function Probe() {
    latest = useUploadStatus();
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<Probe />);
  });
  return { api: () => latest, unmount: () => act(() => tree.unmount()) };
}

describe('useUploadStatus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts idle — no card, no notice', () => {
    const { api, unmount } = render();
    expect(api().status).toBeNull();
    expect(api().notice).toBeNull();
    unmount();
  });

  it('begin → progress → finish carries the summary and the tone', () => {
    const { api, unmount } = render();
    act(() => {
      api().begin(3, 'jobs/weekly');
    });
    expect(api().status).toMatchObject({ fileCount: 3, targetDir: 'jobs/weekly', loaded: 0, total: 0 });

    act(() => api().progress(40, 100));
    expect(api().status).toMatchObject({ loaded: 40, total: 100 });

    act(() => api().finish('3 file(s) uploaded (1 overwritten)', 'warning'));
    expect(api().status).toMatchObject({
      completed: true,
      // A completion frame fills the bar rather than freezing at the last tick.
      loaded: 100,
      summary: '3 file(s) uploaded (1 overwritten)',
      tone: 'warning',
    });
    unmount();
  });

  it('a finished card auto-dismisses', () => {
    const { api, unmount } = render();
    act(() => {
      api().begin(1, '');
    });
    act(() => api().finish());
    expect(api().status?.completed).toBe(true);
    act(() => vi.advanceTimersByTime(3000));
    expect(api().status).toBeNull();
    unmount();
  });

  it('fail clears the card outright — the caller reports the error itself', () => {
    const { api, unmount } = render();
    act(() => {
      api().begin(2, 'x');
    });
    act(() => api().fail());
    expect(api().status).toBeNull();
    unmount();
  });

  it('cancel aborts the signal begin handed out', () => {
    const { api, unmount } = render();
    let signal!: AbortSignal;
    act(() => {
      signal = api().begin(2, 'x');
    });
    expect(signal.aborted).toBe(false);
    act(() => api().cancel());
    expect(signal.aborted).toBe(true);
    unmount();
  });

  it('cancel on a FINISHED card dismisses instead of aborting', () => {
    const { api, unmount } = render();
    let signal!: AbortSignal;
    act(() => {
      signal = api().begin(1, 'x');
    });
    act(() => api().finish());
    act(() => api().cancel());
    expect(signal.aborted).toBe(false);
    expect(api().status).toBeNull();
    unmount();
  });

  it('a notice shows without a card and clears itself', () => {
    const { api, unmount } = render();
    act(() => api().showNotice('No pipeline.yaml in the upload'));
    expect(api().notice).toBe('No pipeline.yaml in the upload');
    expect(api().status).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(api().notice).toBeNull();
    unmount();
  });

  it('a second notice replaces the first and restarts its own clock', () => {
    const { api, unmount } = render();
    act(() => api().showNotice('first'));
    act(() => vi.advanceTimersByTime(2000));
    act(() => api().showNotice('second'));
    act(() => vi.advanceTimersByTime(2000));
    expect(api().notice).toBe('second');
    act(() => vi.advanceTimersByTime(1000));
    expect(api().notice).toBeNull();
    unmount();
  });

  it('a new upload replaces a still-lingering completed card, and the old linger does not dismiss it', () => {
    const { api, unmount } = render();
    act(() => {
      api().begin(1, 'a');
    });
    act(() => api().finish('done'));
    act(() => {
      api().begin(5, 'b');
    });
    expect(api().status).toMatchObject({ fileCount: 5, targetDir: 'b' });
    expect(api().status?.completed).toBeUndefined();
    act(() => vi.advanceTimersByTime(3000));
    expect(api().status).toMatchObject({ fileCount: 5 });
    unmount();
  });
});
