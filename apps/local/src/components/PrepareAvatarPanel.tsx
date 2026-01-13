"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CourseVideoProject } from "@evb/shared";
import InlineErrorBlock from "./ui/InlineErrorBlock";
import {
  PrepareAvatarArtifacts,
  PrepareAvatarJobStatus,
  fetchPrepareAvatarArtifacts,
  pollPrepareAvatarJobStatus,
  submitPrepareAvatarJob
} from "../lib/localAvatarEngine";
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

const createVideoUrl = (base64: string) => {
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    array[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([array], { type: "video/mp4" });
  return URL.createObjectURL(blob);
};

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
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleCancel = () => {
    abortRef.current?.abort();
    setJobState("idle");
    setJobError("Preparation canceled");
  };

  const handlePrepare = useCallback(async () => {
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
      const preparationHint = forcePrepare ? "force_prepare" : undefined;
      await submitPrepareAvatarJob({
        jobId,
        clipId,
        avatarId: project.localAvatarAdvanced?.avatarId ?? "default",
        imagePngBase64: imageBase64,
        audioBase64: audioData.base64,
        audioMime: audioData.mime,
        fps,
        bboxShift,
        preparationHint
      });
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
        const url = createVideoUrl(artifacts.mp4Base64);
        setPreviewUrl((prev) => {
          if (prev) {
            URL.revokeObjectURL(prev);
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
            disabled={!canSubmit}
            onClick={handlePrepare}
          >
            Prepare
          </button>
          {jobState === "failed" && (
            <button
              type="button"
              className="btn-secondary"
              disabled={!canSubmit}
              onClick={() => void handlePrepare()}
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
        {previewUrl && (
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
