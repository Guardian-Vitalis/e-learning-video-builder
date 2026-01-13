import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./fetchArtifact";
import type { JobRecord } from "@evb/shared";

const okResponse = () => new Response("ok", { status: 200 });
const expiredResponse = () => new Response("", { status: 410 });

describe("fetchWithRetry", () => {
  it("retries once on retryable status", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(expiredResponse());
    fetchMock.mockResolvedValueOnce(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const refresh = vi.fn().mockResolvedValue({
      id: "job-1",
      status: "succeeded",
      progress: { phase: "complete", pct: 100 },
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      artifacts: {
        mp4Path: "/v1/jobs/job-1/artifacts/video.mp4?token=new",
        vttPath: "/v1/jobs/job-1/artifacts/captions.vtt?token=new",
        srtPath: "/v1/jobs/job-1/artifacts/captions.srt?token=new",
        expiresAt: "2024-01-01T00:00:00.000Z"
      }
    } as JobRecord);

    const res = await fetchWithRetry({
      url: "http://localhost/old",
      refresh,
      isRetryableStatus: (status) => [401, 403, 410].includes(status),
      getUrlAfterRefresh: (job) => `http://localhost${job.artifacts?.vttPath ?? ""}`
    });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://localhost/v1/jobs/job-1/artifacts/captions.vtt?token=new"
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
