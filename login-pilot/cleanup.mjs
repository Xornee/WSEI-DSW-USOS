/** Keeps failed resources owned until deletion succeeds; no detached rejection. */
export function createCleanup({ retryMs = 1000, deadlineMs = 5000 } = {}) {
  const pending = new Map();
  let stopped = false;
  const attempt = async (worker) => {
    const entry = pending.get(worker);
    if (!entry || entry.running || Date.now() < entry.next) return;
    entry.running = true;
    entry.operation = Promise.resolve().then(() => worker.close()).then(() => {
      pending.delete(worker);
    }, () => {
      entry.failures++;
      entry.next = Date.now() + Math.min(retryMs * 2 ** Math.min(entry.failures - 1, 5), 30_000);
      console.error('WORKER_CLEANUP_PENDING', pending.size);
    }).finally(() => { entry.running = false; });
    let timeout;
    await Promise.race([entry.operation, new Promise(resolve => { timeout = setTimeout(resolve, deadlineMs); })]);
    clearTimeout(timeout);
  };
  const timer = setInterval(() => {
    for (const worker of pending.keys()) void attempt(worker).catch(() => console.error('CLEANUP_RETRY_FAILED'));
  }, retryMs);
  timer.unref();
  return {
    get size() { return pending.size; },
    async release(worker) {
      if (!worker || stopped) return;
      if (!pending.has(worker)) pending.set(worker, { failures: 0, running: false, next: 0 });
      await attempt(worker);
    },
    async close() {
      clearInterval(timer);
      for (const entry of pending.values()) entry.next = 0;
      await Promise.all([...pending.keys()].map(attempt));
      stopped = true;
      if (pending.size) console.error('CLEANUP_REQUIRES_RECONCILIATION', pending.size);
    },
  };
}
