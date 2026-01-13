"use client";

import { useEffect, useState } from "react";
import { ensureWavBase64FromBlob } from "../../lib/audio/wav";

type PreviewClip = {
  id: string;
  index: number;
  mp4Url?: string;
  vttUrl?: string;
  srtUrl?: string;
  lastRenderedAt?: string | null;
  usesOverlay: boolean;
};

type CaptionState = {
  status: "idle" | "loading" | "loaded" | "error";
  text?: string;
  error?: string;
};

type Props = {
  clip: PreviewClip;
  captionState?: CaptionState;
  onLoadCaption?: (clipId: string, url: string) => void;
  localAvatarPreview?: {
    config?: { avatarId: string; fps: number; bboxShift: number } | null;
    refImageDataUrl?: string | null;
    hint?: string | null;
  };
  localAvatarStatus?: "idle" | "queued" | "running" | "succeeded" | "failed";
  localAvatarError?: string | null;
  localAvatarPreviewUrl?: string | null;
  localAvatarCacheLabel?: string | null;
  localAvatarAudioStatus?: "idle" | "loading" | "ready" | "failed";
  localAvatarAudioError?: string | null;
  onRunLocalAvatar?: (clipId: string) => void;
  onRetryLocalAvatar?: (clipId: string) => void;
  onAudioReady?: (clipId: string, data: { wavBase64?: string; error?: string }) => void;
};

const WAV_MIME_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/vnd.wave"
]);

export default function ClipPreviewRow({
  clip,
  captionState,
  onLoadCaption,
  localAvatarPreview,
  localAvatarStatus = "idle",
  localAvatarError = null,
  localAvatarPreviewUrl = null,
  localAvatarCacheLabel = null,
  localAvatarAudioStatus = "idle",
  localAvatarAudioError = null,
  onRunLocalAvatar,
  onRetryLocalAvatar,
  onAudioReady
}: Props) {
  const captionUrl = clip.vttUrl ?? clip.srtUrl;
  const [audioFile, setAudioFile] = useState<File | null>(null);

  const localConfig = localAvatarPreview?.config ?? null;
  const localRefImage = localAvatarPreview?.refImageDataUrl ?? null;
  const localHint = localAvatarPreview?.hint ?? null;
  const localReady = Boolean(localConfig && localRefImage);

  useEffect(() => {
    if (!audioFile || !onAudioReady) {
      return;
    }
    const audioType = audioFile.type.toLowerCase();
    const hasWavExtension = audioFile.name.toLowerCase().endsWith(".wav");
    if (!WAV_MIME_TYPES.has(audioType) && !hasWavExtension) {
      onAudioReady(clip.id, { error: "Audio must be WAV for local avatar generation." });
      return;
    }
    let cancelled = false;
    ensureWavBase64FromBlob(audioFile)
      .then((audioData) => {
        if (cancelled) {
          return;
        }
        onAudioReady(clip.id, { wavBase64: audioData.base64 });
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        onAudioReady(clip.id, { error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [audioFile, clip.id, onAudioReady]);

  return (
    <div className="rounded border border-slate-200 px-2 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-700">Clip {clip.index + 1}</span>
        <span className="text-[11px] text-slate-500">
          {clip.usesOverlay ? "Overlay script (current)" : "Base script (current)"}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Last rendered: {clip.lastRenderedAt ?? "Unknown"}
      </p>
      {clip.mp4Url ? (
        <div className="mt-2">
          <video controls preload="metadata" style={{ width: "100%" }}>
            <source src={clip.mp4Url} type="video/mp4" />
          </video>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-slate-500">Not generated yet.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {clip.mp4Url && (
          <a className="text-slate-700 underline hover:text-slate-900" href={clip.mp4Url}>
            MP4
          </a>
        )}
        {clip.vttUrl && (
          <a className="text-slate-700 underline hover:text-slate-900" href={clip.vttUrl}>
            VTT
          </a>
        )}
        {clip.srtUrl && (
          <a className="text-slate-700 underline hover:text-slate-900" href={clip.srtUrl}>
            SRT
          </a>
        )}
      </div>
      <div className="mt-2 text-[11px] text-slate-500">
        {!captionUrl && <p>Not generated yet.</p>}
        {captionUrl && captionState?.status === "loading" && <p>Loading captions...</p>}
        {captionUrl && captionState?.status === "error" && (
          <p>Captions unavailable: {captionState.error}</p>
        )}
        {captionUrl && captionState?.status === "loaded" && (
          <pre className="mt-2 whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600">
            {captionState.text}
          </pre>
        )}
        {captionUrl && (!captionState || captionState.status === "idle") && (
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-[11px]"
            onClick={() => onLoadCaption?.(clip.id, captionUrl)}
          >
            Load captions
          </button>
        )}
      </div>
      <div className="mt-3 rounded border border-slate-200 bg-white px-2 py-2 text-[11px] text-slate-600">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-slate-600">
            Local avatar preview
          </span>
          <span className="text-[10px] text-slate-500">Status: {localAvatarStatus}</span>
        </div>
        {!localReady && localHint && (
          <p className="mt-2 text-[11px] text-slate-500">{localHint}</p>
        )}
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-[10px] text-slate-500">Override audio (WAV)</span>
          <input
            type="file"
            accept="audio/wav,audio/x-wav,audio/vnd.wave"
            className="text-[11px] text-slate-600"
            onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <p className="mt-2 text-[11px] text-slate-500">
          Audio: {localAvatarAudioStatus === "ready"
            ? "ready"
            : localAvatarAudioStatus === "loading"
              ? "deriving..."
              : localAvatarAudioStatus === "failed"
                ? "failed"
                : "will derive on render"}
        </p>
        {localAvatarAudioError && (
          <p className="mt-1 text-[11px] text-rose-600">{localAvatarAudioError}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-[11px]"
            disabled={!localReady || localAvatarStatus === "queued" || localAvatarStatus === "running"}
            onClick={() => onRunLocalAvatar?.(clip.id)}
          >
            Render local preview
          </button>
          {localAvatarStatus === "failed" && (
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-[11px]"
              disabled={!localReady || localAvatarStatus === "queued" || localAvatarStatus === "running"}
              onClick={() => onRetryLocalAvatar?.(clip.id)}
            >
              Retry
            </button>
          )}
          {localAvatarCacheLabel && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-slate-700">
              {localAvatarCacheLabel}
            </span>
          )}
        </div>
        {localAvatarError && (
          <p className="mt-2 text-[11px] text-rose-600">{localAvatarError}</p>
        )}
        {localAvatarPreviewUrl && (
          <div className="mt-2">
            <video controls preload="metadata" style={{ width: "100%" }}>
              <source src={localAvatarPreviewUrl} type="video/mp4" />
            </video>
          </div>
        )}
      </div>
    </div>
  );
}
