/**
 * Run an async job over a list with a bounded number in flight.
 *
 * Both enrichment chains end in a per-item network leg, and both fired the
 * whole remainder at once (`Promise.allSettled(remaining.map(...))`). For an
 * eCrew report that is a handful of registrations and it does not matter. For
 * a LogTen migration it is every tail a career touched — hundreds of
 * simultaneous requests through one proxy route, each holding an 8-second
 * timeout, which is how a slow lookup turns into a stalled import rather than
 * a slow one.
 *
 * A pool keeps the same total work and the same wall-clock shape for small
 * batches, while giving a large one a queue instead of a stampede. Failures
 * are the job's own business — this never throws, matching `allSettled`.
 */
export const DEFAULT_POOL_SIZE = 6;

export async function pooledForEach<T>(
  items: readonly T[],
  job: (item: T, index: number) => Promise<void>,
  poolSize = DEFAULT_POOL_SIZE
): Promise<void> {
  if (items.length === 0) return;

  const width = Math.max(1, Math.min(poolSize, items.length));
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await job(items[index], index);
      } catch {
        // The job owns its own error handling; a throw must not take down the
        // other workers or the pool as a whole.
      }
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
}
