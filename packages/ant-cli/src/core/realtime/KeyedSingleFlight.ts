/**
 * Per-key single-flight with trailing coalescing.
 *
 * Background (M-009): every file-mutating tool call and every artifact mutation
 * API asks for a file-tree refresh, and each request used to start its own full
 * recursive scan + Redis write + Pub/Sub publish. A burst of writes (an agent
 * creating a dozen files, or a client calling the mutation APIs in parallel)
 * multiplied the shared-filesystem and event-loop cost by the number of writes
 * while producing near-identical payloads.
 *
 * Concurrent callers join the in-flight run; ONE further run starts when a
 * request arrives DURING a run, so the last mutation is always reflected —
 * coalescing, not dropping. Worst case per burst is 2 runs regardless of N.
 *
 * There is deliberately NO timer / debounce window: the run's own duration IS
 * the coalescing window. A `setTimeout` would make a scheduled-but-not-started
 * rerun invisible to a shutdown flush (see `InflightTracker`), silently dropping
 * the end-of-job broadcast. If a minimum interval is ever needed, it must ship
 * together with a `flushPending()` that close paths call first.
 *
 * Distinct from {@link InflightTracker}, which must not be merged into this:
 * single-flight is about not doing redundant work, tracking is about not losing
 * work at shutdown. `onRun` is the seam between them.
 */
export interface KeyedSingleFlightOptions {
  /**
   * Invoked with every run's promise — the initial run AND each coalesced
   * rerun. Lets a caller register both with its own `InflightTracker` so
   * flush-on-close covers the trailing run too.
   */
  onRun?: (p: Promise<void>) => void;
}

export class KeyedSingleFlight {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly rerun = new Set<string>();
  private readonly onRun?: (p: Promise<void>) => void;

  constructor(options: KeyedSingleFlightOptions = {}) {
    this.onRun = options.onRun;
  }

  /**
   * Run `fn` for `key`, coalescing against any run already in flight for it.
   * The returned promise resolves once *a* run for this key has completed.
   */
  run(key: string, fn: () => Promise<void>): Promise<void> {
    const inFlight = this.inFlight.get(key);
    if (inFlight) {
      // Mark that a request arrived during the running pass, then join it.
      this.rerun.add(key);
      return inFlight;
    }

    // `finally` always clears the map entry — a rejecting `fn` must not wedge
    // the key permanently.
    const p = fn().finally(() => {
      this.inFlight.delete(key);
      if (this.rerun.delete(key)) {
        void this.run(key, fn);
      }
    });
    this.inFlight.set(key, p);
    this.onRun?.(p);
    return p;
  }

  /** Number of keys with a run in flight. Test seam. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }
}
