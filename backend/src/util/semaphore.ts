export function createSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    if (active >= limit || queue.length === 0) return;
    active++;
    queue.shift()!();
  }

  function acquire(): Promise<void> {
    return new Promise((resolve) => {
      queue.push(resolve);
      next();
    });
  }

  function release(): void {
    active--;
    next();
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
