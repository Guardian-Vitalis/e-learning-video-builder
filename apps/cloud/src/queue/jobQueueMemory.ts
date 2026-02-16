type Waiter = (jobId: string | null) => void;

const queue: string[] = [];
const waiters: Waiter[] = [];

export function resetJobQueueMemory() {
  queue.length = 0;
  waiters.length = 0;
}

export async function enqueueJob(jobId: string) {
  if (waiters.length > 0) {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(jobId);
      return;
    }
  }
  queue.push(jobId);
}

export async function dequeueJobBlocking(timeoutSeconds = 30): Promise<string | null> {
  if (queue.length > 0) {
    return queue.shift() ?? null;
  }
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      const index = waiters.indexOf(waiter);
      if (index >= 0) {
        waiters.splice(index, 1);
      }
      resolve(null);
    }, timeoutSeconds * 1000);

    const waiter: Waiter = (jobId) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(jobId);
    };

    waiters.push(waiter);
  });
}
