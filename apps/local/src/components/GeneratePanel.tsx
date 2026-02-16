"use client";

import { useEffect, useState } from "react";
import { CourseVideoProject, JobRecord, StubAvatarStyle, StubBackgroundStyle } from "@evb/shared";
import Link from "next/link";
import {
  CloudApiError,
  getCloudApiBaseUrl,
  retryJob
} from "../api/cloud";
import {
  canGenerate,
  clearGenerationJob,
  setGenerationJobInstance,
  updateProject,
  resetApprovalToDraft,
  ValidationError,
  updateGenerationJobStatus,
  startGenerationJob
} from "../lib/storage/projectsStore";
import InlineErrorBlock from "./ui/InlineErrorBlock";
import { buildTableImagesPayload } from "../lib/cloud/buildTableImagesPayload";
import {
  assertProjectApproved,
  buildGenerationJobRequest,
  GenerationGateError
} from "../lib/generation/generationDispatch";
import { filterDraftManifestSections } from "../lib/generation/generationFiltering";
import { getPreviewGeneratorUiHints } from "../lib/config/previewGeneratorConfig";
import { useRuntimePreviewConfig } from "../lib/hooks/useRuntimePreviewConfig";
import { getLocalAvatarEngineUrl } from "../lib/localAvatarEngine";

type Props = {
  project: CourseVideoProject;
  onProjectUpdated: (project: CourseVideoProject) => void;
};

function isJobNotFound(err: CloudApiError) {
  if (err.status !== 404) {
    return false;
  }
  try {
    const parsed = JSON.parse(err.body) as {
      error?: string | { code?: string; upstreamBody?: { error?: string } };
    };
    if (parsed?.error === "not_found") {
      return true;
    }
    if (typeof parsed?.error === "object") {
      return (
        parsed.error.code === "upstream_not_found" ||
        parsed.error.upstreamBody?.error === "not_found"
      );
    }
    return false;
  } catch {
    return err.body.includes("not_found");
  }
}

export default function GeneratePanel({ project, onProjectUpdated }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [cloudOk, setCloudOk] = useState<boolean | null>(null);
  const [redisOk, setRedisOk] = useState<boolean | null>(null);
  const [workerOk, setWorkerOk] = useState<boolean | null>(null);
  const [workerAgeSeconds, setWorkerAgeSeconds] = useState<number | null>(null);
  const [redisMode, setRedisMode] = useState<"redis" | "memory" | null>(null);
  const [redisModeLabel, setRedisModeLabel] = useState<string | null>(null);
  const [storeLabel, setStoreLabel] = useState<string | null>(null);
  const [queueLabel, setQueueLabel] = useState<string | null>(null);
  const [instanceLabel, setInstanceLabel] = useState<string | null>(null);
  const [showDevStatus, setShowDevStatus] = useState(false);
  const [healthMissing, setHealthMissing] = useState(false);
  const [workerMissing, setWorkerMissing] = useState(false);
  const [tableImagesNote, setTableImagesNote] = useState<string | null>(null);
  const [restartBanner, setRestartBanner] = useState<string | null>(null);
  const [overrideSentencesPerClip, setOverrideSentencesPerClip] = useState<number | null>(
    null
  );
  const [overrideVariationsPerSection, setOverrideVariationsPerSection] = useState<
    number | null
  >(null);
  const [stubAvatarStyle, setStubAvatarStyle] = useState<StubAvatarStyle>("silhouette");
  const [stubBackgroundStyle, setStubBackgroundStyle] = useState<StubBackgroundStyle>("neutral");

  const baseUrl = (() => {
    try {
      return getCloudApiBaseUrl();
    } catch {
      return "";
    }
  })();
  const previewGeneratorHints = getPreviewGeneratorUiHints();
  const runtimeConfig = useRuntimePreviewConfig();
  const previewGeneratorUrl = runtimeConfig?.previewGeneratorBaseUrl ?? previewGeneratorHints.baseUrl;
  const previewGeneratorLabel = previewGeneratorUrl ?? "not set";
  const detectedSource =
    runtimeConfig?.source ?? (previewGeneratorHints.configured ? "process_env" : "unset");
  const previewGeneratorConfigured = Boolean(previewGeneratorUrl);
  const baseUrlMissing = !previewGeneratorConfigured || !baseUrl;
  const localAvatarEngineUrl =
    runtimeConfig?.localAvatarEngineUrl ?? getLocalAvatarEngineUrl();
  const job = project.generationJob;
  const effectiveCleanupMode =
    project.scriptCleanupMode ?? (project.sourceDoc ? "deterministic" : "off");
  const approvalStatus = project.approvalStatus ?? "draft";

  useEffect(() => {
    if (!project.generationSettings) {
      setOverrideSentencesPerClip(null);
      setOverrideVariationsPerSection(null);
      return;
    }
    const overrides = project.projectSettingsOverrides;
    setOverrideSentencesPerClip(
      overrides?.sentencesPerClip ?? project.generationSettings.sentencesPerClip
    );
    setOverrideVariationsPerSection(
      overrides?.variationsPerSection ?? project.generationSettings.variationsPerSection
    );
  }, [project.generationSettings, project.projectSettingsOverrides]);

  useEffect(() => {
    setStubAvatarStyle(project.stubAvatarStyle ?? "silhouette");
    setStubBackgroundStyle(project.stubBackgroundStyle ?? "neutral");
  }, [project.stubAvatarStyle, project.stubBackgroundStyle]);

  const handleStaleJob = (message?: string) => {
    const next = clearGenerationJob(project.id);
    onProjectUpdated(next);
    setError("Cloud restarted (new instance). Previous job IDs are no longer available.");
    setErrorDetails(message ?? "Please generate again.");
    setRestartBanner("Cloud restarted (new instance). Previous job IDs are no longer available. Please generate again.");
  };

  const handleSaveOverrides = () => {
    if (!project.generationSettings) {
      return;
    }
    if (
      overrideSentencesPerClip === null ||
      overrideVariationsPerSection === null
    ) {
      return;
    }
    try {
      const next = updateProject({
        id: project.id,
        projectSettingsOverrides: {
          sentencesPerClip: overrideSentencesPerClip,
          variationsPerSection: overrideVariationsPerSection
        }
      });
      onProjectUpdated(next);
      setError(null);
      setErrorDetails(null);
    } catch (err) {
      if (err instanceof ValidationError) {
        setError(err.message);
        const details = err.fieldErrors
          ? Object.values(err.fieldErrors).join(" ")
          : undefined;
        setErrorDetails(details ?? null);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setError("Unable to save overrides.");
      setErrorDetails(message);
    }
  };

  const handleSaveStubStyles = () => {
    try {
      const next = updateProject({
        id: project.id,
        stubAvatarStyle,
        stubBackgroundStyle
      });
      onProjectUpdated(next);
      setError(null);
      setErrorDetails(null);
    } catch (err) {
      if (err instanceof ValidationError) {
        setError(err.message);
        setErrorDetails(null);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setError("Unable to save stub visuals.");
      setErrorDetails(message);
    }
  };

  const handleResetApproval = () => {
    try {
      const next = resetApprovalToDraft(project.id);
      onProjectUpdated(next);
      setError(null);
      setErrorDetails(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError("Unable to reset approval.");
      setErrorDetails(message);
    }
  };

  useEffect(() => {
    if (!baseUrl || !showDevStatus) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pollStatus = async () => {
      try {
        const res = await fetch(`${baseUrl}/v1/health?ts=${Date.now()}`, {
          cache: "no-store"
        });
        if (res.status === 404) {
          if (!cancelled) {
            setCloudOk(true);
            setHealthMissing(true);
            setRedisOk(null);
          }
          return;
        }
        if (!res.ok) {
          throw new Error(`health ${res.status}`);
        }
        const data = (await res.json()) as {
          ok: boolean;
          redisOk: boolean | null;
          mode?: string;
          store?: string;
          queue?: string;
          instanceId?: string;
        };
        if (!cancelled) {
          setCloudOk(data.ok);
          setRedisOk(data.redisOk);
          if (data.store === "memory" || data.queue === "memory" || data.mode === "solo") {
            setRedisMode("memory");
          } else if (data.store === "redis" || data.queue === "redis") {
            setRedisMode("redis");
          } else {
            setRedisMode(null);
          }
          setRedisModeLabel(data.mode ?? null);
          setStoreLabel(data.store ?? null);
          setQueueLabel(data.queue ?? null);
          setInstanceLabel(data.instanceId ?? null);
          setHealthMissing(false);
        }
      } catch {
        if (!cancelled) {
          setCloudOk(false);
          setRedisOk(false);
          setRedisMode(null);
          setRedisModeLabel(null);
          setStoreLabel(null);
          setQueueLabel(null);
          setInstanceLabel(null);
          setHealthMissing(false);
        }
      }

      try {
        const res = await fetch(`${baseUrl}/v1/worker/heartbeat?ts=${Date.now()}`, {
          cache: "no-store"
        });
        if (res.status === 404) {
          if (!cancelled) {
            setWorkerOk(true);
            setWorkerMissing(true);
            setWorkerAgeSeconds(null);
          }
          return;
        }
        const data = (await res.json()) as {
          ok: boolean;
          lastBeatMs?: number | null;
          nowMs?: number | null;
        };
        if (!cancelled) {
          setWorkerOk(data.ok);
          if (typeof data.lastBeatMs === "number" && typeof data.nowMs === "number") {
            const ageSeconds = Math.max(0, Math.floor((data.nowMs - data.lastBeatMs) / 1000));
            setWorkerAgeSeconds(ageSeconds);
          } else {
            setWorkerAgeSeconds(null);
          }
          setWorkerMissing(false);
        }
      } catch {
        if (!cancelled) {
          setWorkerOk(false);
          setWorkerAgeSeconds(null);
          setWorkerMissing(false);
        }
      }

      timer = setTimeout(pollStatus, 5000);
    };

    pollStatus();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [baseUrl, showDevStatus]);

  useEffect(() => {
    if (!baseUrl || showDevStatus || !job?.jobId) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pollInstance = async () => {
      try {
        const res = await fetch(`${baseUrl}/v1/health?ts=${Date.now()}`, {
          cache: "no-store"
        });
        if (res.ok) {
          const data = (await res.json()) as { instanceId?: string };
          if (!cancelled && data.instanceId) {
            setInstanceLabel(data.instanceId);
          }
        }
      } catch {
        // ignore
      }
      timer = setTimeout(pollInstance, 10000);
    };

    pollInstance();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [baseUrl, job?.jobId, showDevStatus]);

  useEffect(() => {
    if (!job?.jobId || !instanceLabel) {
      return;
    }
    if (!job.instanceId) {
      const next = setGenerationJobInstance(project.id, instanceLabel);
      onProjectUpdated(next);
      return;
    }
    if (job.instanceId !== instanceLabel) {
      handleStaleJob();
    }
  }, [instanceLabel, job?.jobId, job?.instanceId, onProjectUpdated, project.id]);

  useEffect(() => {
    if (!job?.jobId || project.status !== "generating") {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const status = await getPreviewJobStatus(job.jobId);
        if (cancelled) {
          return;
        }
        const next = updateGenerationJobStatus(project.id, status);
        onProjectUpdated(next);
        if (status.status === "succeeded" || status.status === "failed") {
          return;
        }
        timer = setTimeout(poll, 2000);
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof CloudApiError) {
          if (isJobNotFound(err)) {
            handleStaleJob("Cloud no longer has this job. Please generate again.");
            return;
          }
          setError("Cloud API error. Check that apps/cloud is running.");
          setErrorDetails(err.body || `status ${err.status}`);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          setError("Cloud API error. Check that apps/cloud is running.");
          setErrorDetails(message);
        }
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [job?.jobId, onProjectUpdated, project.id, project.status]);

  const handleGenerate = async () => {
    if (!previewGeneratorConfigured) {
      return;
    }
    setError(null);
    setErrorDetails(null);
    setTableImagesNote(null);
    setRestartBanner(null);
    setIsSubmitting(true);
    try {
      assertProjectApproved(project);
      if (!project.approvedManifest || !project.generationSettings) {
        return;
      }
      const effectiveSettings = {
        ...project.generationSettings,
        sentencesPerClip:
          project.projectSettingsOverrides?.sentencesPerClip ??
          project.generationSettings.sentencesPerClip,
        variationsPerSection:
          project.projectSettingsOverrides?.variationsPerSection ??
          project.generationSettings.variationsPerSection
      };
      let tableImagesPayload = undefined;
      if (effectiveSettings.outputMode === "avatar_plus_slides") {
        const sections =
          project.draftManifest
            ? filterDraftManifestSections(project.draftManifest, project.outlineDisabledIds)
            : [];
        const { tableImages, totalBytes, skippedCount, skippedMissing, skippedLimit } =
          await buildTableImagesPayload({
            projectId: project.id,
            sections,
            maxImages: 25,
            maxTotalBytes: 15 * 1024 * 1024,
            maxSingleBytes: 5 * 1024 * 1024
          });
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
        const skippedParts: string[] = [];
        if (skippedMissing > 0) {
          skippedParts.push(`Skipped ${skippedMissing} image${skippedMissing === 1 ? "" : "s"} (missing locally).`);
        }
        if (skippedLimit > 0) {
          skippedParts.push(`Skipped ${skippedLimit} image${skippedLimit === 1 ? "" : "s"} due to size limits.`);
        }
        const skipped = skippedParts.length > 0 ? ` ${skippedParts.join(" ")}` : "";
        setTableImagesNote(
          `Slides mode will upload ${tableImages.length} table images (~${totalMb} MB) to Cloud for generation.${skipped}`
        );
        tableImagesPayload = tableImages.length > 0 ? tableImages : undefined;
      }

      const payload = buildGenerationJobRequest({
        project,
        effectiveSettings,
        effectiveCleanupMode,
        stubAvatarStyle,
        stubBackgroundStyle,
        tableImages: tableImagesPayload
      });
      const res = await fetch("/api/generate/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "omit"
      });
      const text = await res.text();
      if (!res.ok) {
        throw new CloudApiError(res.status, text);
      }
      const response = (text ? JSON.parse(text) : {}) as {
        jobId: string;
        status: Parameters<typeof startGenerationJob>[2];
      };
      const next = startGenerationJob(
        project.id,
        response.jobId,
        response.status,
        instanceLabel ?? undefined
      );
      onProjectUpdated(next);
    } catch (err) {
      if (err instanceof GenerationGateError) {
        setError(err.message);
        setErrorDetails(null);
      } else if (err instanceof ValidationError) {
        setError(err.message);
        setErrorDetails(null);
      } else if (err instanceof CloudApiError) {
        let parsed: {
          requestId?: string;
          error?: { code?: string; message?: string; detail?: string; upstream?: string };
          code?: string;
          message?: string;
          detail?: string;
          upstream?: string;
        } = {};
        try {
          parsed = JSON.parse(err.body);
        } catch {
          parsed = {};
        }
        const errorPayload = parsed.error ?? parsed;
        const requestIdSuffix = parsed.requestId ? ` (request ${parsed.requestId})` : "";
        if (err.status === 502 && errorPayload.code === "cloud_unreachable") {
          setError("Generation failed.");
          setErrorDetails(
            [
              "Could not reach preview generator (apps/cloud).",
              errorPayload.upstream ? `Upstream: ${errorPayload.upstream}` : null,
              errorPayload.detail ? `Detail: ${errorPayload.detail}` : null,
              parsed.requestId ? `Request: ${parsed.requestId}` : null
            ]
              .filter(Boolean)
              .join("\n")
          );
          return;
        }
        if (err.status === 413) {
          setError("Upload too large for slides mode.");
          setErrorDetails(
            err.body ||
              "Reduce the number/size of table images or switch to avatar-only mode."
          );
        } else {
          setError(`Request failed (${err.status})`);
          setErrorDetails(
            errorPayload.message
              ? `${errorPayload.message}${requestIdSuffix}`
              : err.body || "No response body"
          );
        }
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError("Cloud API unreachable.");
        setErrorDetails(message.includes("Failed to fetch") ? "Network error." : message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = async () => {
    if (!job?.jobId) {
      return;
    }
    if (!previewGeneratorConfigured) {
      return;
    }
    setError(null);
    setErrorDetails(null);
    setRestartBanner(null);
    try {
      await retryJob(job.jobId);
      const next = startGenerationJob(
        project.id,
        job.jobId,
        job.lastStatus,
        instanceLabel ?? undefined
      );
      onProjectUpdated(next);
    } catch (err) {
      if (err instanceof CloudApiError) {
        if (isJobNotFound(err)) {
          handleStaleJob("Cloud no longer has this job. Please generate again.");
          return;
        }
        setError("Cloud API error. Check that apps/cloud is running.");
        setErrorDetails(err.body || `status ${err.status}`);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError("Cloud API error. Check that apps/cloud is running.");
        setErrorDetails(message);
      }
    }
  };

  const handleClear = () => {
    const next = clearGenerationJob(project.id);
    onProjectUpdated(next);
  };

  const status = job?.lastStatus;
  const eligibility = canGenerate(project);

  const handleRetryStatus = async () => {
    if (!job?.jobId) {
      return;
    }
    if (!previewGeneratorConfigured) {
      return;
    }
    setError(null);
    setErrorDetails(null);
    try {
      const nextStatus = await getPreviewJobStatus(job.jobId);
    const next = updateGenerationJobStatus(project.id, nextStatus);
    onProjectUpdated(next);
    } catch (err) {
      if (err instanceof CloudApiError) {
        if (isJobNotFound(err)) {
          handleStaleJob("Cloud no longer has this job. Please generate again.");
          return;
        }
        setError("Cloud API error. Check that apps/cloud is running.");
        setErrorDetails(err.body || `status ${err.status}`);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError("Cloud API error. Check that apps/cloud is running.");
        setErrorDetails(message);
      }
    }
  };

  const handleCopyLinks = async () => {
    if (!status?.artifacts || !baseUrl) {
      return;
    }
    const links = [
      `MP4: ${baseUrl}${status.artifacts.mp4Path}`,
      `VTT: ${baseUrl}${status.artifacts.vttPath}`,
      `SRT: ${baseUrl}${status.artifacts.srtPath}`
    ].join("\n");
    try {
      await navigator.clipboard.writeText(links);
      setLinkMessage("Links copied.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLinkMessage(`Unable to copy links: ${message}`);
    }
  };

  const handleCopyCommands = async () => {
    const commands = [
      "docker compose up -d",
      "yarn workspace @evb/cloud dev:api",
      "yarn workspace @evb/cloud dev:worker",
      "yarn workspace @evb/local dev -- -p 3001"
    ].join("\n");
    try {
      await navigator.clipboard.writeText(commands);
      setLinkMessage("Commands copied.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLinkMessage(`Unable to copy commands: ${message}`);
    }
  };

  const formatSectionTitle = (title: string) =>
    title.length > 42 ? `${title.slice(0, 39)}...` : title;

  const approvalLabel = approvalStatus === "approved" ? "Approved" : "Draft";
  const approvalClasses =
    approvalStatus === "approved"
      ? "bg-green-100 text-green-800"
      : "bg-slate-100 text-slate-700";

  return (
    <section className="card space-y-4">
      <div>
        <h2>Generation</h2>
        <p className="mt-1 text-sm text-slate-600">
          Start a job and track status updates from the cloud worker.
        </p>
      </div>
      <div className="rounded-md border border-slate-200 p-3 text-sm text-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-slate-800">Approval status</p>
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${approvalClasses}`}>
            {approvalLabel}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {approvalStatus !== "approved" && (
            <Link className="btn-primary w-fit" href={`/projects/${project.id}/review`}>
              Approve now
            </Link>
          )}
          {approvalStatus === "approved" && (
            <button type="button" className="btn-secondary" onClick={handleResetApproval}>
              Reset to Draft
            </button>
          )}
        </div>
      </div>
      <div className="rounded-md border border-slate-200 p-3 text-sm text-slate-700">
        <p className="font-medium text-slate-800">Clip overrides</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-slate-600" htmlFor="override-sentences">
            Sentences per clip
            <input
              id="override-sentences"
              type="number"
              min={1}
              max={5}
              value={overrideSentencesPerClip ?? ""}
              onChange={(event) =>
                setOverrideSentencesPerClip(Number(event.target.value))
              }
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-600" htmlFor="override-variations">
            Variations per section
            <input
              id="override-variations"
              type="number"
              min={1}
              max={5}
              value={overrideVariationsPerSection ?? ""}
              onChange={(event) =>
                setOverrideVariationsPerSection(Number(event.target.value))
              }
            />
          </label>
        </div>
        <button
          type="button"
          className="btn-secondary mt-3"
          onClick={handleSaveOverrides}
          disabled={!project.generationSettings}
        >
          Save overrides
        </button>
      </div>
      <div className="rounded-md border border-slate-200 p-3 text-sm text-slate-700">
        <p className="font-medium text-slate-800">Stub visuals</p>
        <p className="mt-1 text-xs text-slate-500">
          Used when provider=stub. Helps preview realistic avatar presence.
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-slate-600" htmlFor="stub-avatar-style">
            Avatar style
            <select
              id="stub-avatar-style"
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              value={stubAvatarStyle}
              onChange={(event) => setStubAvatarStyle(event.target.value as StubAvatarStyle)}
            >
              <option value="silhouette">Silhouette</option>
              <option value="illustration">Illustration</option>
              <option value="photo">Photo</option>
              <option value="badge">Badge</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-slate-600" htmlFor="stub-background-style">
            Background style
            <select
              id="stub-background-style"
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              value={stubBackgroundStyle}
              onChange={(event) => setStubBackgroundStyle(event.target.value as StubBackgroundStyle)}
            >
              <option value="neutral">Neutral</option>
              <option value="gradient">Gradient</option>
              <option value="classroom">Classroom</option>
            </select>
          </label>
        </div>
        <button type="button" className="btn-secondary mt-3" onClick={handleSaveStubStyles}>
          Save stub visuals
        </button>
      </div>
      {previewGeneratorConfigured && (
        <div className="mt-1 space-y-1 text-xs text-slate-500">
          <p>
            Preview generator: {previewGeneratorLabel}. {previewGeneratorHints.restartHint}.
          </p>
          <p>Local Avatar engine: {localAvatarEngineUrl}.</p>
        </div>
      )}
      {restartBanner && (
        <InlineErrorBlock message={restartBanner} />
      )}
      {tableImagesNote && <p className="text-sm text-slate-600">{tableImagesNote}</p>}
      {error && (
        <InlineErrorBlock message={error} details={errorDetails ?? undefined} />
      )}
      {status ? (
        <>
          <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <p>Job ID: {job?.jobId}</p>
            <p>Status: {status.status}</p>
            <p>Phase: {status.progress.phase}</p>
            <p>Progress: {status.progress.pct}%</p>
          </div>
          {status.sectionsProgress && (
            <details className="rounded-md border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">
                Section progress
              </summary>
              {status.sectionsProgress.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">
                  No section progress available yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {status.sectionsProgress.map((section) => (
                    <li key={section.sectionId}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-800">
                          {formatSectionTitle(section.title)}
                        </span>
                        <span className="text-xs text-slate-500">
                          {section.status} - {section.phase} ({section.pct}%)
                        </span>
                      </div>
                      {section.error && (
                        <InlineErrorBlock
                          message={section.error.message}
                          details={section.error.details}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}
          {status.error && <p className="text-sm text-red-600">Error: {status.error.message}</p>}
          {status.artifacts && baseUrl && (
            <>
              <p className="text-sm text-slate-600">
                Artifacts (expires {status.artifacts.expiresAt})
              </p>
              <ul className="space-y-1 text-sm">
                <li>
                  <a className="text-slate-700 underline hover:text-slate-900" href={`${baseUrl}${status.artifacts.mp4Path}`}>
                    Download MP4
                  </a>
                </li>
                <li>
                  <a className="text-slate-700 underline hover:text-slate-900" href={`${baseUrl}${status.artifacts.vttPath}`}>
                    Download VTT
                  </a>
                </li>
                <li>
                  <a className="text-slate-700 underline hover:text-slate-900" href={`${baseUrl}${status.artifacts.srtPath}`}>
                    Download SRT
                  </a>
                </li>
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn-secondary" onClick={handleCopyLinks}>
                  Copy links
                </button>
                <button type="button" className="btn-secondary" onClick={handleRetryStatus}>
                  Refresh links
                </button>
                {linkMessage && <p className="text-xs text-slate-500">{linkMessage}</p>}
              </div>
            </>
          )}
          {status.status === "failed" && (
            <button type="button" className="btn-primary" onClick={handleRetry}>
              Retry
            </button>
          )}
          {(status.status === "succeeded" || status.status === "failed") && (
            <button type="button" className="btn-secondary" onClick={handleClear}>
              Clear job
            </button>
          )}
        </>
      ) : job ? (
        <p className="text-sm text-slate-600">
          Job created: {job.jobId}. Waiting for status...
        </p>
      ) : (
        <p className="text-sm text-slate-600">No generation job yet.</p>
      )}
      {!job && eligibility.ok && (
        <>
          <p className="text-sm text-slate-600">Approved + Settings ready.</p>
          {tableImagesNote && <p>{tableImagesNote}</p>}
          <button
            type="button"
            className="btn-primary"
            onClick={handleGenerate}
            disabled={isSubmitting || baseUrlMissing}
          >
            {isSubmitting
              ? "Starting..."
            : previewGeneratorConfigured
                ? "Generate"
                : "Generate (preview generator disabled)"}
          </button>
          {!previewGeneratorConfigured && (
            <p className="text-xs text-slate-500">
              Preview generator not configured — required to create MP4 previews.
            </p>
          )}
        </>
      )}
      {!job && !eligibility.ok && (
        <>
          {eligibility.reason === "not_approved" && (
            <>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Approve required before generation.</p>
                <p className="mt-1 text-xs text-amber-900">
                  Current status: {approvalStatus}.
                </p>
                <Link className="btn-primary mt-3 w-fit" href={`/projects/${project.id}/review`}>
                  Approve now
                </Link>
              </div>
              <button type="button" className="btn-secondary" disabled>
                Generate (requires approval)
              </button>
            </>
          )}
          {eligibility.reason === "settings_incomplete" && (
            <>
              <p className="text-sm text-slate-600">Approved, but settings are missing.</p>
              <button type="button" className="btn-secondary" disabled>
                Generate (requires settings)
              </button>
              <Link className="btn-ghost w-fit" href={`/projects/${project.id}/settings`}>
                Configure settings
              </Link>
            </>
          )}
          {eligibility.reason === "missing_manifest" && (
            <>
              <p className="text-sm text-slate-600">Approved manifest is missing.</p>
              <button type="button" className="btn-secondary" disabled>
                Generate (requires approval)
              </button>
              <Link className="btn-ghost w-fit" href={`/projects/${project.id}#upload-docx`}>
                Upload .docx
              </Link>
            </>
          )}
        </>
      )}
      {job && (
        <button
          type="button"
          className="btn-secondary"
          onClick={handleRetryStatus}
          disabled={baseUrlMissing}
        >
          Retry status
        </button>
      )}
      <div className="rounded-md border border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3>Dev Stack Status</h3>
          <button type="button" className="btn-ghost" onClick={() => setShowDevStatus((value) => !value)}>
            {showDevStatus ? "Hide" : "Show"}
          </button>
        </div>
        {showDevStatus && (
          <div className="mt-2 space-y-1 text-sm text-slate-700">
            <p>
              Cloud API: {cloudOk === null ? "Checking..." : cloudOk ? "OK" : "Down"}
            </p>
            <p>
              Cloud URL: {baseUrl || "Missing"}
            </p>
            <p>
              Instance: {instanceLabel ?? "Unknown"}
            </p>
            <p>
              Mode: {redisModeLabel ?? "Unknown"} | Store: {storeLabel ?? "Unknown"} | Queue: {queueLabel ?? "Unknown"}
            </p>
            <p>
              Redis: {redisOk === null ? "N/A (solo)" : redisOk ? "OK" : "Down"}
            </p>
            <p>
              Worker: {workerOk === null
                ? "Checking..."
                : workerOk
                  ? `OK${workerAgeSeconds !== null ? ` (${workerAgeSeconds}s)` : ""}`
                  : "Down"}
            </p>
            <button type="button" className="btn-secondary" onClick={handleCopyCommands}>
              Copy commands
            </button>
            {healthMissing && (
              <p className="text-xs text-slate-500">
                Hint: /v1/health missing. Pull latest cloud changes.
              </p>
            )}
            {workerMissing && (
              <p className="text-xs text-slate-500">
                Hint: /v1/worker/heartbeat missing. Pull latest cloud changes.
              </p>
            )}
            {!cloudOk && (
              <p className="text-xs text-slate-500">
                Hint: Start Cloud API: yarn workspace @evb/cloud dev:api
              </p>
            )}
            {cloudOk && redisOk === false && redisMode !== "memory" && (
              <p className="text-xs text-slate-500">
                Hint: Start Redis: docker compose up -d
              </p>
            )}
            {cloudOk && workerOk === false && (
              <p className="text-xs text-slate-500">
                Hint: Start worker: yarn workspace @evb/cloud dev:worker
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
  const getPreviewJobStatus = async (jobId: string) => {
    const res = await fetch(
      `/api/generate/preview/status?jobId=${encodeURIComponent(jobId)}`,
      { cache: "no-store" }
    );
    const text = await res.text();
    if (!res.ok) {
      throw new CloudApiError(res.status, text);
    }
    const parsed = (text ? JSON.parse(text) : {}) as { status?: JobRecord } & JobRecord;
    return (parsed.status ?? parsed) as JobRecord;
  };
