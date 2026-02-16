"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CourseVideoProject } from "@evb/shared";
import InlineErrorBlock from "./ui/InlineErrorBlock";
import {
  PrepareAvatarArtifacts,
  PrepareAvatarJobStatus,
  fetchPrepareAvatarArtifacts,
  pollPrepareAvatarJobStatus
} from "../lib/localAvatarEngine";
import { getLocalAvatarEngineUrl } from "../lib/localAvatarEngine";
import { ensureWavBase64FromBlob } from "../lib/audio/wav";
import { updateProject } from "../lib/storage/projectsStore";

type Props = {
  project: CourseVideoProject;
  onProjectUpdate: (project: CourseVideoProject) => void;
};

const createVideoThumbnail = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let seeked = false;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.addEventListener("loadeddata", () => {
      video.currentTime = Math.min(0.2, video.duration || 0);
    });
    video.addEventListener("seeked", () => {
      if (seeked) {
        return;
      }
      seeked = true;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 640;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        reject(new Error("Unable to capture thumbnail"));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/png");
      const prefix = "data:image/png;base64,";
      const base64 = dataUrl.startsWith(prefix)
        ? dataUrl.slice(prefix.length)
        : dataUrl.split(",")[1] ?? "";
      cleanup();
      resolve(base64);
    });
    video.addEventListener("error", () => {
      cleanup();
      reject(new Error("Failed to load video"));
    });
  });

export default function PrepareAvatarPanel({ project, onProjectUpdate }: Props) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [fps, setFps] = useState(project.localAvatar?.fps ?? 25);
  const [bboxShift, setBboxShift] = useState(project.localAvatar?.bboxShift ?? 0);
  const [forcePrepare, setForcePrepare] = useState(false);
  const [jobState, setJobState] = useState<"idle" | "preparing" | "polling" | "succeeded" | "failed">(
    "idle"
  );
  const [jobStatus, setJobStatus] = useState<PrepareAvatarJobStatus | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewProbe, setPreviewProbe] = useState<{
    status: "idle" | "loading" | "pass" | "fail";
    statusCode?: number;
    contentType?: string | null;
    requestId?: string | null;
    message?: string | null;
    snippet?: string | null;
    contentLength?: string | null;
  }>({ status: "idle" });
  const [readiness, setReadiness] = useState<{
    ready: boolean;
    checks: { name: string; ok: boolean; detail?: string | null }[];
    reasons: string[];
    engineBuildId?: string | null;
    suggestedFix?: string[];
    detected?: { pythonBin?: string | null; pythonVersion?: string | null } | null;
  } | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const loadReadiness = async () => {
      try {
        const baseUrl = getLocalAvatarEngineUrl();
        const res = await fetch(`${baseUrl}/v1/local-avatar/health`, {
          signal: controller.signal
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Readiness failed (${res.status}): ${text}`);
        }
        const data = (await res.json()) as {
          ready?: boolean;
          checks?: { name: string; ok: boolean; detail?: string | null }[];
          reasons?: string[];
          engineBuildId?: string | null;
          suggestedFix?: string[];
          detected?: { pythonBin?: string | null; pythonVersion?: string | null } | null;
        };
        if (!active) return;
        setReadiness({
          ready: Boolean(data.ready),
          checks: Array.isArray(data.checks) ? data.checks : [],
          reasons: Array.isArray(data.reasons) ? data.reasons : [],
          engineBuildId: data.engineBuildId ?? null,
          suggestedFix: Array.isArray(data.suggestedFix) ? data.suggestedFix : [],
          detected: data.detected ?? null
        });
        setReadinessError(null);
      } catch (err) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : String(err);
        setReadinessError(msg);
      }
    };
    void loadReadiness();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!previewUrl) {
      setPreviewProbe({ status: "idle" });
      return;
    }
    let active = true;
    const controller = new AbortController();
    const probe = async () => {
      setPreviewProbe({ status: "loading" });
      try {
        const res = await fetch(previewUrl, {
          headers: { Range: "bytes=0-1" },
          signal: controller.signal
        });
        const contentType = res.headers.get("content-type") ?? "";
        const contentLength = res.headers.get("content-length");
        const requestId =
          res.headers.get("x-request-id") ?? res.headers.get("x-requestid");
        let message: string | null = null;
        let snippet: string | null = null;
        let errorCode: string | null = null;
        let errorReason: string | null = null;
        if (contentType.includes("application/json")) {
          const text = await res.text();
          snippet = text.slice(0, 200);
          try {
            const parsed = JSON.parse(text) as {
              error?: unknown;
              reason?: unknown;
              message?: unknown;
            };
            if (typeof parsed?.error === "string") {
              errorCode = parsed.error;
            }
            if (typeof parsed?.reason === "string") {
              errorReason = parsed.reason;
            }
            const parsedMessage = parsed?.message;
            if (typeof parsedMessage === "string") {
              message = parsedMessage;
            }
          } catch {
            // keep snippet only
          }
        } else if (!res.ok || (res.status !== 200 && res.status !== 206)) {
          const text = await res.text();
          snippet = text ? text.slice(0, 200) : null;
        }

        const isVideoType =
          contentType.includes("video/") || contentType === "application/octet-stream";
        const okStatus = res.status === 200 || res.status === 206;

        if (okStatus && isVideoType) {
          if (!active) return;
          setPreviewProbe({
            status: "pass",
            statusCode: res.status,
            contentType,
            requestId,
            contentLength
          });
          return;
        }

        if (!active) return;
        setPreviewProbe({
          status: "fail",
          statusCode: res.status,
          contentType,
          requestId,
          message: errorReason ?? message,
          snippet,
          contentLength
        });
        if (errorCode === "preview_invalid") {
          if (!active) return;
          setJobState("failed");
          setJobError(errorReason ?? "Preview MP4 is invalid");
        }
      } catch (err) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : String(err);
        setPreviewProbe({
          status: "fail",
          message: "Preview probe failed.",
          snippet: msg
        });
      }
    };
    void probe();
    return () => {
      active = false;
      controller.abort();
    };
  }, [previewUrl]);

  const previewProbeDetails =
    previewProbe.status === "fail"
      ? [
          `status: ${previewProbe.statusCode ?? "n/a"}`,
          `content-type: ${previewProbe.contentType ?? "n/a"}`,
          previewProbe.contentLength ? `content-length: ${previewProbe.contentLength}` : null,
          previewProbe.requestId ? `requestId: ${previewProbe.requestId}` : null,
          previewProbe.message ? `message: ${previewProbe.message}` : null,
          previewProbe.snippet ? `body: ${previewProbe.snippet}` : null
        ]
          .filter(Boolean)
          .join("\n")
      : null;

  useEffect(() => {
    return () => {
      if (previewUrl) {
        if (previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(previewUrl);
        }
      }
    };
  }, [previewUrl]);

  const handleCancel = () => {
    abortRef.current?.abort();
    setJobState("idle");
    setJobError("Preparation canceled");
  };

  const handlePrepare = useCallback(async (options?: { force?: boolean }) => {
    if (!videoFile || !audioFile) {
      setJobError("Select both video and audio files.");
      return;
    }
    setJobError(null);
    setJobState("preparing");
    try {
      const imageBase64 = await createVideoThumbnail(videoFile);
      const audioData = await ensureWavBase64FromBlob(audioFile);
      const jobId = `prep-${project.id}-${Date.now()}`;
      const clipId = "clip0";
      const shouldForce = options?.force || forcePrepare;
      const preparationHint = shouldForce ? "force_prepare" : undefined;
      const baseUrl = getLocalAvatarEngineUrl();
      const form = new FormData();
      form.append("jobId", jobId);
      form.append("clipId", clipId);
      form.append("avatarId", project.localAvatarAdvanced?.avatarId ?? "default");
      form.append("imagePngBase64", imageBase64);
      form.append("audioBase64", audioData.base64);
      form.append("audioMime", audioData.mime);
      form.append("fps", String(fps));
      form.append("bboxShift", String(bboxShift));
      if (preparationHint) {
        form.append("preparationHint", preparationHint);
      }
      if (videoFile) {
        form.append("sourceVideo", videoFile, videoFile.name || "source.mp4");
      }
      const submitRes = await fetch(`${baseUrl}/v1/jobs`, {
        method: "POST",
        body: form
      });
      if (!submitRes.ok) {
        const text = await submitRes.text();
        throw new Error(`Prepare job submit failed (status ${submitRes.status}): ${text}`);
      }
      await submitRes.json();
      setJobState("polling");
      const controller = new AbortController();
      abortRef.current = controller;
      const status = await pollPrepareAvatarJobStatus({
        jobId,
        clipId,
        signal: controller.signal
      });
      setJobStatus(status);
      if (status.status === "succeeded") {
        const artifacts = await fetchPrepareAvatarArtifacts({ jobId, clipId });
        const url = `${getLocalAvatarEngineUrl()}/v1/jobs/${encodeURIComponent(jobId)}/${encodeURIComponent(clipId)}/artifacts.mp4`;
        setPreviewUrl((prev) => {
          if (prev) {
            if (prev.startsWith("blob:")) {
              URL.revokeObjectURL(prev);
            }
          }
          return url;
        });
        const meta = {
          avatarId: project.localAvatarAdvanced?.avatarId ?? "default",
          fps,
          bboxShift,
          prepKey: status.prepKey ?? undefined,
          lastPreparedAt: new Date().toISOString(),
          lastCacheHit:
            typeof status.cacheHit === "boolean" ? status.cacheHit : undefined,
          refImageDataUrl: `data:image/png;base64,${imageBase64}`
        };
        const updated = updateProject({ id: project.id, localAvatar: meta });
        onProjectUpdate(updated);
        setJobState("succeeded");
      } else {
        setJobState("failed");
        setJobError(status.error ?? "Preparation failed");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setJobState("idle");
        return;
      }
      setJobState("failed");
      const message = err instanceof Error ? err.message : String(err);
      setJobError(message);
    } finally {
      abortRef.current = null;
    }
  }, [audioFile, bboxShift, forcePrepare, fps, project, videoFile, onProjectUpdate]);

  const statusPill = useMemo(() => {
    if (jobState === "preparing") {
      return "Preparing";
    }
    if (jobState === "polling") {
      return "Queued / running";
    }
    if (jobState === "succeeded") {
      return "Succeeded";
    }
    if (jobState === "failed") {
      return "Failed";
    }
    return "Idle";
  }, [jobState]);

  const statusCacheInfo = jobStatus?.status === "succeeded" ? jobStatus : null;
  const storedCacheInfo = jobState === "idle" ? project.localAvatar : null;
  const cacheHit = statusCacheInfo?.cacheHit ?? storedCacheInfo?.lastCacheHit;
  const prepKey = statusCacheInfo?.prepKey ?? storedCacheInfo?.prepKey;
  const hasCacheInfo = typeof cacheHit === "boolean" || typeof prepKey === "string";
  const canSubmit =
    Boolean(videoFile && audioFile) && jobState !== "preparing" && jobState !== "polling";
  const readinessOk = readiness?.ready ?? true;
  const canPrepare = canSubmit && readinessOk;
  const lastCacheLabel =
    project.localAvatar && typeof project.localAvatar.lastCacheHit === "boolean"
      ? project.localAvatar.lastCacheHit
        ? "yes"
        : "no"
      : "unknown";

  return (
    <section className="card space-y-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2>Prepare Avatar</h2>
            <p className="text-sm text-slate-600">
              Upload a source video + audio to generate a MuseTalk preparation job.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              jobState === "succeeded"
                ? "bg-emerald-100 text-emerald-800"
                : jobState === "failed"
                ? "bg-rose-100 text-rose-800"
                : "bg-slate-100 text-slate-800"
            }`}
          >
            {statusPill}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 rounded-md border border-slate-200 px-3 py-2">
            <span className="text-xs font-semibold text-slate-500 block">Source video</span>
            <input
              type="file"
              accept="video/*"
              className="w-full text-sm text-slate-700"
              onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label className="space-y-1 rounded-md border border-slate-200 px-3 py-2">
            <span className="text-xs font-semibold text-slate-500 block">Audio</span>
            <input
              type="file"
              accept="audio/*"
              className="w-full text-sm text-slate-700"
              onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="text-xs font-semibold text-slate-500">FPS</span>
            <input
              type="number"
              value={fps}
              min={1}
              onChange={(event) => setFps(Number(event.target.value))}
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-semibold text-slate-500">BBox shift</span>
            <input
              type="number"
              value={bboxShift}
              onChange={(event) => setBBoxShift(Number(event.target.value))}
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={forcePrepare}
              onChange={(event) => setForcePrepare(event.target.checked)}
            />
            <span className="text-xs text-slate-600">Force prepare</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="btn-primary"
            disabled={!canPrepare}
            onClick={handlePrepare}
          >
            Prepare
          </button>
          {jobState === "failed" && (
            <button
              type="button"
              className="btn-secondary"
              disabled={!canPrepare}
              onClick={() => void handlePrepare({ force: true })}
            >
              Retry failed clip
            </button>
          )}
          {jobState === "polling" && (
            <button type="button" className="btn-ghost" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
        {jobError && <InlineErrorBlock message="Preparation failed" details={jobError} />}
        {readinessError && (
          <InlineErrorBlock message="Engine readiness check failed" details={readinessError} />
        )}
        {readiness && !readiness.ready && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
            <div className="font-semibold">Local engine not ready</div>
            {readiness.engineBuildId && (
              <div className="text-xs">build: {readiness.engineBuildId}</div>
            )}
            {readiness.detected?.pythonVersion && (
              <div className="text-xs">
                python: {readiness.detected.pythonVersion}
                {readiness.detected.pythonBin ? ` (${readiness.detected.pythonBin})` : ""}
              </div>
            )}
            {readiness.reasons.length > 0 && (
              <ul className="list-disc pl-4">
                {readiness.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
            {readiness.suggestedFix && readiness.suggestedFix.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-100 p-2 text-xs">
                {readiness.suggestedFix.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            )}
            {readiness.checks.length > 0 && (
              <div className="text-xs text-amber-800">
                {readiness.checks.map((check) => (
                  <div key={check.name}>
                    {check.ok ? "✓" : "✗"} {check.name}: {check.detail ?? "n/a"}
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                const payload = JSON.stringify(readiness, null, 2);
                try {
                  await navigator.clipboard.writeText(payload);
                } catch {
                  // ignore
                }
              }}
            >
              Copy readiness details
            </button>
          </div>
        )}
        {hasCacheInfo && (
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
            {typeof cacheHit === "boolean" && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5">
                {cacheHit ? "Cache hit" : "Fresh prepare"}
              </span>
            )}
            {prepKey && (
              <span className="text-xs text-slate-500">Prep key: {prepKey}</span>
            )}
          </div>
        )}
        {previewUrl && previewProbe.status === "loading" && (
          <p className="text-sm text-slate-600">Checking preview stream...</p>
        )}
        {previewUrl && previewProbe.status === "fail" && (
          <InlineErrorBlock
            title="Preview video not playable"
            message="The prepared avatar preview did not look like a playable MP4."
            details={previewProbeDetails ?? undefined}
          />
        )}
        {previewUrl && previewProbe.status === "pass" && (
          <video controls src={previewUrl} className="max-w-full rounded-md border border-slate-200" />
        )}
        {project.localAvatar && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p>Last prepared: {project.localAvatar.lastPreparedAt ?? "unknown"}</p>
            <p>FPS: {project.localAvatar.fps}, BBox shift: {project.localAvatar.bboxShift}</p>
            <p>Cache hit: {lastCacheLabel}</p>
          </div>
        )}
      </div>
    </section>
  );
}
