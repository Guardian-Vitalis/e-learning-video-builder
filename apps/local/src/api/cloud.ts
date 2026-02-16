import {
  ApprovedManifest,
  CreateJobRequest,
  CreateJobResponse,
  DocxImportRequest,
  DocxImportResponse,
  GenerationSettings,
  JobRecord,
  RetryJobResponse
} from "@evb/shared";

export class CloudApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`status ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

let cloudBaseUrl: string | null = null;

export function setCloudApiBaseUrl(baseUrl: string) {
  cloudBaseUrl = baseUrl.replace(/\/$/, "");
}

export function getCloudApiBaseUrl() {
  return requireBaseUrl();
}

function requireBaseUrl() {
  if (!cloudBaseUrl) {
    throw new Error("Cloud API base URL not configured");
  }
  return cloudBaseUrl;
}

const logCloud = process.env.NEXT_PUBLIC_EVB_LOG_CLOUD === "1";

async function requestJson<T>(url: string, options: RequestInit) {
  if (logCloud) {
    const method = options.method ?? "GET";
    console.log(`[local] cloud ${method} ${url}`);
  }
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    if (logCloud) {
      console.warn(`[local] cloud error ${res.status} ${url} body=${text}`);
    }
    throw new CloudApiError(res.status, text);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function createGenerationJob(input: {
  projectId: string;
  manifest?: ApprovedManifest;
  sourceDoc?: CreateJobRequest["sourceDoc"];
  selectedSectionIds?: CreateJobRequest["selectedSectionIds"];
  targetSectionIds?: CreateJobRequest["targetSectionIds"];
  scriptCleanupMode?: CreateJobRequest["scriptCleanupMode"];
  cleanupConfigOverrides?: CreateJobRequest["cleanupConfigOverrides"];
  stubAvatarStyle?: CreateJobRequest["stubAvatarStyle"];
  stubBackgroundStyle?: CreateJobRequest["stubBackgroundStyle"];
  localAvatarAdvanced?: CreateJobRequest["localAvatarAdvanced"];
  settings: GenerationSettings;
  tableImages?: CreateJobRequest["tableImages"];
}) {
  const url = `${requireBaseUrl()}/v1/jobs`;
  const body: CreateJobRequest = {
    projectId: input.projectId,
    manifest: input.manifest,
    sourceDoc: input.sourceDoc,
    selectedSectionIds: input.selectedSectionIds,
    targetSectionIds: input.targetSectionIds,
    scriptCleanupMode: input.scriptCleanupMode,
    cleanupConfigOverrides: input.cleanupConfigOverrides,
    stubAvatarStyle: input.stubAvatarStyle,
    stubBackgroundStyle: input.stubBackgroundStyle,
    localAvatarAdvanced: input.localAvatarAdvanced,
    settings: input.settings,
    tableImages: input.tableImages
  };
  return requestJson<CreateJobResponse>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getJob(jobId: string) {
  const url = `${requireBaseUrl()}/v1/jobs/${jobId}`;
  return requestJson<JobRecord>(url, { method: "GET" });
}

export async function retryJob(jobId: string) {
  const url = `${requireBaseUrl()}/v1/jobs/${jobId}/retry`;
  const data = await requestJson<RetryJobResponse>(url, { method: "POST" });
  return data.jobId;
}

export async function importDocx(input: DocxImportRequest) {
  const url = `${requireBaseUrl()}/v1/import/docx`;
  return requestJson<DocxImportResponse>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export type AdminJobItem = {
  jobId: string;
  status: string;
  updatedAt?: string;
  retryCount?: number;
  lastError?: string | null;
  leaseOk?: boolean;
  leaseOwner?: string | null;
  leaseTtlMs?: number | null;
  artifacts?: {
    mp4Path?: string;
    vttPath?: string;
    srtPath?: string;
    manifestPath?: string;
    expiresAt?: string;
  };
};

export type AdminJobEvent = {
  tsMs: number;
  type: string;
  data?: Record<string, any>;
};

export type AdminRecoverResult = {
  lockAcquired: boolean;
  scanned: number;
  requeued: number;
  failed: number;
  skipped: number;
};

export async function adminJobsList(input: { status?: string; limit?: number }) {
  const status = input.status ?? "running";
  const limit = input.limit ?? 50;
  const url = `${requireBaseUrl()}/v1/admin/jobs?status=${encodeURIComponent(
    status
  )}&limit=${limit}`;
  return requestJson<{ items: AdminJobItem[] }>(url, { method: "GET" });
}

export async function adminJobGet(jobId: string) {
  const url = `${requireBaseUrl()}/v1/admin/jobs/${jobId}`;
  return requestJson<JobRecord & { leaseOk?: boolean; leaseOwner?: string | null; leaseTtlMs?: number | null }>(
    url,
    { method: "GET" }
  );
}

export async function adminJobEvents(jobId: string) {
  const url = `${requireBaseUrl()}/v1/admin/jobs/${jobId}/events`;
  return requestJson<{ jobId: string; events: AdminJobEvent[] }>(url, { method: "GET" });
}

export async function adminRecover() {
  const url = `${requireBaseUrl()}/v1/admin/recover`;
  return requestJson<AdminRecoverResult>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
}

export type LocalAvatarHealthDetailsResponse = {
  enabled: boolean;
  reachable?: boolean;
  reason?: string;
  error?: string;
  fetchedAt?: string;
  details?: Record<string, unknown>;
};

export async function getLocalAvatarHealthDetails() {
  const url = `${requireBaseUrl()}/v1/health/local-avatar/details`;
  return requestJson<LocalAvatarHealthDetailsResponse>(url, { method: "GET" });
}
