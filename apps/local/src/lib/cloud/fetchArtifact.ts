import type { JobRecord } from "@evb/shared";

type FetchWithRetryInput = {
  url: string;
  refresh: () => Promise<JobRecord>;
  isRetryableStatus: (status: number) => boolean;
  getUrlAfterRefresh?: (job: JobRecord) => string;
};

export async function fetchWithRetry(input: FetchWithRetryInput): Promise<Response> {
  const first = await fetch(input.url);
  if (!input.isRetryableStatus(first.status)) {
    return first;
  }
  const refreshed = await input.refresh();
  const nextUrl = input.getUrlAfterRefresh
    ? input.getUrlAfterRefresh(refreshed)
    : input.url;
  return fetch(nextUrl);
}
