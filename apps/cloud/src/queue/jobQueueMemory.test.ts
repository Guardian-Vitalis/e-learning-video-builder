import { afterEach, describe, expect, it } from "vitest";
import { dequeueJobBlocking, enqueueJob, resetJobQueueMemory } from "./jobQueueMemory";

describe("jobQueueMemory", () => {
  afterEach(() => {
    resetJobQueueMemory();
  });

  it("enqueues and dequeues job ids", async () => {
    await enqueueJob("job-1");
    const jobId = await dequeueJobBlocking(1);
    expect(jobId).toBe("job-1");
  });
});
