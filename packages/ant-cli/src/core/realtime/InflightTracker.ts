/**
 * Tracks fire-and-forget broadcasts so a close-on-shutdown can `flush()`
 * them before `pubRedis.quit()` cuts off an in-flight publish.
 *
 * Background: short jobs (e.g. `plan`) emit a single end-of-graph file-tree
 * broadcast; without flushing, the FE never receives it.
 */
export class InflightTracker {
  private readonly pending = new Set<Promise<unknown>>();

  track<T>(p: Promise<T>): Promise<T> {
    this.pending.add(p);
    p.then(
      () => { this.pending.delete(p); },
      () => { this.pending.delete(p); },
    );
    return p;
  }

  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    await Promise.allSettled([...this.pending]);
  }

  get size(): number {
    return this.pending.size;
  }
}
