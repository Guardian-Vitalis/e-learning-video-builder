"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ClipPreviewRow from "./ClipPreviewRow";
import {
  ensureClipAudioWavBase64,
  getLocalAvatarEngineUrl,
  mp4Base64ToObjectUrl,
  runLocalAvatarClip
} from "../../lib/localAvatarEngine";
import { useRuntimePreviewConfig } from "../../lib/hooks/useRuntimePreviewConfig";

type PreviewClip = {
  id: string;
  index: number;
  mp4Url?: string;
  vttUrl?: string;
  srtUrl?: string;
  lastRenderedAt?: string | null;
  usesOverlay: boolean;
};

type Props = {
  clips: PreviewClip[];
  previewJobId: string | null;
  previewCaptions?: Record<
    string,
    { status: "idle" | "loading" | "loaded" | "error"; text?: string; error?: string }
  >;
  onLoadPreviewCaption?: (clipId: string, url: string) => void;
  localAvatarPreview?: {
    config?: { avatarId: string; fps: number; bboxShift: number } | null;
    refImageDataUrl?: string | null;
    hint?: string | null;
  };
};

type LocalClipStatus = "idle" | "queued" | "running" | "succeeded" | "failed";
type LocalAudioStatus = "idle" | "loading" | "ready" | "failed";

export default function SectionRenderPreview({
  clips,
  previewJobId,
  previewCaptions,
  onLoadPreviewCaption,
  localAvatarPreview
}: Props) {
  const params = useParams();
  const projectId = (() => {
    const id = params?.id;
    if (Array.isArray(id)) {
      return id[0] ?? null;
    }
    return typeof id === "string" ? id : null;
  })();
  const runtimeConfig = useRuntimePreviewConfig();
  const previewGeneratorUrl = runtimeConfig?.previewGeneratorBaseUrl ?? null;
  const previewGeneratorLabel = previewGeneratorUrl ?? "not set";
  const previewGeneratorSource =
    runtimeConfig?.source ?? (previewGeneratorLabel !== "not set" ? "process_env" : "unset");
  const localAvatarEngineUrl =
    runtimeConfig?.localAvatarEngineUrl ?? getLocalAvatarEngineUrl();
  const engineConfigured = Boolean(runtimeConfig?.localAvatarEngineUrl);
  const previewConfigured = Boolean(runtimeConfig?.previewGeneratorBaseUrl);
  const [clipStates, setClipStates] = useState<
    Record<
      string,
      {
        status: LocalClipStatus;
        error?: string | null;
        previewUrl?: string | null;
        cacheLabel?: string | null;
      }
    >
  >({});
  const [clipAudio, setClipAudio] = useState<
    Record<string, { wavBase64?: string; sourceKey?: string }>
  >({});
  const [audioStatus, setAudioStatus] = useState<
    Record<string, { status: LocalAudioStatus; error?: string | null }>
  >({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const batchAbortRef = useRef<AbortController | null>(null);
  const clipStateRef = useRef(clipStates);

  useEffect(() => {
    clipStateRef.current = clipStates;
  }, [clipStates]);

  useEffect(() => {
    return () => {
      Object.values(clipStateRef.current).forEach((entry) => {
        if (entry.previewUrl) {
          URL.revokeObjectURL(entry.previewUrl);
        }
      });
    };
  }, []);

  const missingMp4Count = clips.filter((clip) => !clip.mp4Url).length;
  const totalClips = clips.length;
  const hasClips = totalClips > 0;
  const blockedReason = !hasClips
    ? "no_clips"
    : !engineConfigured
      ? "missing_engine"
      : !previewConfigured
        ? "missing_preview"
        : null;
  const batchStatus = (() => {
    if (totalClips === 0) {
      return {
        label: "Blocked",
        hint: "No clips yet (approve a script first).",
        dotClass: "bg-rose-500"
      };
    }
    if (!engineConfigured) {
      return {
        label: "Blocked",
        hint: "Local avatar engine not configured (set NEXT_PUBLIC_EVB_LOCAL_AVATAR_ENGINE_URL).",
        dotClass: "bg-rose-500"
      };
    }
    if (!previewConfigured) {
      return {
        label: "Blocked",
        hint: "Preview generator not configured (set NEXT_PUBLIC_CLOUD_API_BASE_URL).",
        dotClass: "bg-rose-500"
      };
    }
    if (missingMp4Count > 0) {
      return {
        label: "Partial",
        hint: `${missingMp4Count}/${totalClips} clips missing MP4 previews (run Generate, or use Override WAV).`,
        dotClass: "bg-amber-500"
      };
    }
    return {
      label: "Ready",
      hint: "All clips have MP4 previews.",
      dotClass: "bg-emerald-500"
    };
  })();
  const isBlocked = batchStatus.label === "Blocked";
  const fixHref = (() => {
    if (!isBlocked || !blockedReason) {
      return null;
    }
    if (blockedReason === "missing_engine") {
      return projectId ? `/projects/${projectId}/settings` : "./settings";
    }
    if (blockedReason === "missing_preview") {
      return "#generate";
    }
    return "#script-approval";
  })();
  const fixIsAnchor = Boolean(fixHref?.startsWith("#"));
  const statusSummary = useMemo(() => {
    const total = clips.length;
    if (total === 0) {
      return { total, completed: 0, running: 0 };
    }
    let completed = 0;
    let running = 0;
    clips.forEach((clip) => {
      const status = clipStates[clip.id]?.status ?? "idle";
      if (status === "succeeded" || status === "failed") {
        completed += 1;
      }
      if (status === "queued" || status === "running") {
        running += 1;
      }
    });
    return { total, completed, running };
  }, [clips, clipStates]);

  const setClipState = (clipId: string, patch: Partial<(typeof clipStates)[string]>) => {
    setClipStates((prev) => ({
      ...prev,
      [clipId]: { ...(prev[clipId] ?? { status: "idle" as LocalClipStatus }), ...patch }
    }));
  };

  const setClipPreviewUrl = (clipId: string, nextUrl: string) => {
    setClipStates((prev) => {
      const existing = prev[clipId];
      if (existing?.previewUrl && existing.previewUrl !== nextUrl) {
        URL.revokeObjectURL(existing.previewUrl);
      }
      return {
        ...prev,
        [clipId]: { ...(existing ?? { status: "idle" as LocalClipStatus }), previewUrl: nextUrl }
      };
    });
  };

  const updateAudio = (clipId: string, data: { wavBase64?: string; error?: string }) => {
    if (data.wavBase64) {
      const sourceKey = `b64:${data.wavBase64.length}:${data.wavBase64.slice(0, 32)}`;
      setClipAudio((prev) => ({
        ...prev,
        [clipId]: { wavBase64: data.wavBase64, sourceKey }
      }));
      setAudioStatus((prev) => ({ ...prev, [clipId]: { status: "ready", error: null } }));
      setClipStates((prev) => {
        const next = { ...(prev[clipId] ?? { status: "idle" as LocalClipStatus }) };
        if (next.status === "failed") {
          next.status = "idle";
        }
        next.error = null;
        return { ...prev, [clipId]: next };
      });
      return;
    }
    if (data.error) {
      setAudioStatus((prev) => ({ ...prev, [clipId]: { status: "failed", error: data.error } }));
      setClipState(clipId, { status: "failed", error: data.error });
    }
  };

  const generateRunId = () => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };

  const runClip = async (
    clip: PreviewClip,
    runId: string,
    controller: AbortController
  ) => {
    if (!localAvatarPreview?.config || !localAvatarPreview.refImageDataUrl) {
      setClipState(clip.id, {
        status: "failed",
        error: localAvatarPreview?.hint ?? "Local avatar preview is not available yet."
      });
      return;
    }
    setAudioStatus((prev) => ({ ...prev, [clip.id]: { status: "loading", error: null } }));
    let audioWavBase64 = "";
    try {
      const audio = await ensureClipAudioWavBase64({
        clipId: clip.id,
        clip,
        signal: controller.signal,
        overrideWavBase64: clipAudio[clip.id]?.wavBase64,
        overrideSourceKey: clipAudio[clip.id]?.sourceKey
      });
      audioWavBase64 = audio.wavBase64;
      setAudioStatus((prev) => ({ ...prev, [clip.id]: { status: "ready", error: null } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorText = message === "aborted" ? "Cancelled." : message;
      setAudioStatus((prev) => ({ ...prev, [clip.id]: { status: "failed", error: errorText } }));
      setClipState(clip.id, {
        status: "failed",
        error: `Unable to derive audio for this clip. ${errorText}`
      });
      return;
    }

    setClipState(clip.id, { status: "queued", error: null, cacheLabel: null });
    try {
      const result = await runLocalAvatarClip({
        jobId: `${runId}:${clip.id}`,
        clipId: clip.id,
        avatarId: localAvatarPreview.config.avatarId,
        fps: localAvatarPreview.config.fps,
        bboxShift: localAvatarPreview.config.bboxShift,
        imagePngDataUrl: localAvatarPreview.refImageDataUrl,
        audioWavBase64,
        signal: controller.signal,
        intervalMs: 700,
        onStatus: (status) => {
          if (status.status === "queued" || status.status === "running") {
            setClipState(clip.id, { status: status.status });
          }
        }
      });
      setClipPreviewUrl(clip.id, mp4Base64ToObjectUrl(result.mp4Base64));
      setClipState(clip.id, {
        status: "succeeded",
        cacheLabel:
          typeof result.cacheHit === "boolean"
            ? result.cacheHit
              ? "Cache hit"
              : "Fresh prepare"
            : null
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setClipState(clip.id, { status: "failed", error: "Cancelled." });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setClipState(clip.id, { status: "failed", error: message });
    }
  };

  const runBatch = async (targets: PreviewClip[]) => {
    if (batchRunning) {
      return;
    }
    const runId = generateRunId();
    const controller = new AbortController();
    batchAbortRef.current = controller;
    setBatchRunning(true);
    try {
      for (const clip of targets) {
        if (controller.signal.aborted) {
          break;
        }
        await runClip(clip, runId, controller);
      }
    } finally {
      if (batchAbortRef.current === controller) {
        batchAbortRef.current = null;
      }
      setBatchRunning(false);
    }
  };

  const handleRunAll = () => {
    runBatch(clips);
  };

  const handleRetryFailed = () => {
    const failed = clips.filter((clip) => {
      const status = clipStates[clip.id]?.status ?? "idle";
      return status === "failed" && (Boolean(clipAudio[clip.id]?.wavBase64) || Boolean(clip.mp4Url));
    });
    if (failed.length === 0) {
      return;
    }
    runBatch(failed);
  };

  const handleCancel = () => {
    batchAbortRef.current?.abort();
  };

  const handleRunSingle = (clipId: string) => {
    const clip = clips.find((entry) => entry.id === clipId);
    if (!clip) {
      return;
    }
    runBatch([clip]);
  };

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-600">Preview render</p>
        {previewJobId && (
          <span className="text-xs text-slate-500">Job {previewJobId.slice(0, 8)}</span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Preview generator: {previewGeneratorLabel} (source: {previewGeneratorSource}). Local Avatar engine: {localAvatarEngineUrl}.
      </p>
      <p className="text-[11px] text-slate-500">
        Local Avatar auto audio derivation requires per-clip MP4 previews (or supply Override WAV for a clip).
      </p>
      {hasClips ? (
        <>
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-[11px] text-slate-600">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-700">
                Local avatar batch
              </span>
              <span className="text-[10px] text-slate-500">
                {statusSummary.completed}/{statusSummary.total} complete
                {statusSummary.running > 0 ? ` - ${statusSummary.running} running` : ""}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className={`h-2 w-2 rounded-full ${batchStatus.dotClass}`} />
              <span className="font-medium text-slate-700">Local avatar batch:</span>
              <span className="text-slate-700">{batchStatus.label}</span>
              <span className="text-slate-500">{batchStatus.hint}</span>
              {localAvatarEngineUrl && (
                <a
                  className="text-[11px] text-slate-500 underline hover:text-slate-700"
                  href={localAvatarEngineUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open engine
                </a>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-[11px]"
                disabled={isBlocked || batchRunning}
                onClick={handleRunAll}
              >
                Generate all (Local Avatar)
              </button>
              {isBlocked && (
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-[11px] underline"
                  onClick={() => setShowWhy((value) => !value)}
                >
                  Why?
                </button>
              )}
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-[11px]"
                disabled={batchRunning}
                onClick={handleRetryFailed}
              >
                Retry failed
              </button>
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-[11px]"
                disabled={!batchRunning}
                onClick={handleCancel}
              >
                Cancel
              </button>
            </div>
            {isBlocked && showWhy && (
              <p className="mt-2 text-[11px] text-slate-500">
                Blocked: {batchStatus.hint}{" "}
                {fixHref &&
                  (fixIsAnchor ? (
                    <a className="underline hover:text-slate-700" href={fixHref}>
                      Fix it
                    </a>
                  ) : (
                    <Link className="underline hover:text-slate-700" href={fixHref}>
                      Fix it
                    </Link>
                  ))}
              </p>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Script source reflects current draft state.
          </p>
          <div className="mt-2 space-y-2">
            {clips.map((clip) => (
              <ClipPreviewRow
                key={clip.id}
                clip={clip}
                captionState={previewCaptions?.[clip.id]}
                onLoadCaption={onLoadPreviewCaption}
                localAvatarPreview={localAvatarPreview}
                localAvatarStatus={clipStates[clip.id]?.status ?? "idle"}
                localAvatarError={clipStates[clip.id]?.error ?? null}
                localAvatarPreviewUrl={clipStates[clip.id]?.previewUrl ?? null}
                localAvatarCacheLabel={clipStates[clip.id]?.cacheLabel ?? null}
                localAvatarAudioStatus={audioStatus[clip.id]?.status ?? "idle"}
                localAvatarAudioError={audioStatus[clip.id]?.error ?? null}
                onRunLocalAvatar={handleRunSingle}
                onRetryLocalAvatar={handleRunSingle}
                onAudioReady={updateAudio}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`h-2 w-2 rounded-full ${batchStatus.dotClass}`} />
            <span className="font-medium text-slate-700">Local avatar batch:</span>
            <span className="text-slate-700">{batchStatus.label}</span>
            <span className="text-slate-500">{batchStatus.hint}</span>
          </div>
        </div>
      )}
    </div>
  );
}
