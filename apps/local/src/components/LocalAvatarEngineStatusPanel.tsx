"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import InlineErrorBlock from "./ui/InlineErrorBlock";
import { fetchLocalAvatarDoctor, LocalAvatarDoctorResponse } from "../lib/localAvatarEngine";

const TEMPLATE = `# Local MuseTalk .env.local
EVB_MUSETALK_REPO_DIR=
EVB_MUSETALK_MODELS_DIR=
EVB_MUSETALK_PYTHON=
EVB_FFMPEG_PATH=
EVB_LOCAL_AVATAR_CACHE_KEYS=1
`;

export default function LocalAvatarEngineStatusPanel() {
  const [status, setStatus] = useState<LocalAvatarDoctorResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const refresh = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const data = await fetchLocalAvatarDoctor();
      setStatus(data);
      setState("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus(null);
      setState("error");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isReady = useMemo(() => {
    if (!status) {
      return false;
    }
    const ready =
      status.mode === "musetalk" &&
      status.musetalk?.repoDirExists &&
      status.musetalk.python?.ok &&
      status.musetalk.torch?.ok &&
      status.musetalk.ffmpeg?.ok &&
      (status.musetalk.models?.missing?.length ?? 0) === 0;
    return ready;
  }, [status]);

  const copyTemplate = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(TEMPLATE);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }, []);

  const actionItems = status?.actionItems ?? [];
  const missingModels = status?.musetalk?.models?.missing ?? [];
  const envFiles = status?.resolved?.envFilesLoaded ?? [];

  return (
    <section className="card space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2>Local Avatar Engine Status</h2>
          <p className="text-sm text-slate-600">
            MuseTalk readiness for the local engine. Auto-refreshes when the panel loads.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`px-3 py-1 text-xs font-semibold rounded-full ${
              isReady ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
            }`}
          >
            {isReady ? "MuseTalk Ready" : "Not Ready"}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={refresh}
            disabled={state === "loading"}
          >
            {state === "loading" ? "Refreshing..." : "Refresh status"}
          </button>
        </div>
      </div>
      {error && (
        <InlineErrorBlock
          message="Local engine unreachable"
          details={`${error}. Start it with yarn workspace @evb/local-avatar-engine dev`}
        />
      )}
      {!error && !status && (
        <p className="text-sm text-slate-500">Checking the local Avatar engine…</p>
      )}
      {status && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Mode</p>
              <p className="text-lg font-semibold text-slate-900">{status.mode ?? "unknown"}</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Prepared avatars</p>
              <p className="text-lg font-semibold text-slate-900">
                {status.cache?.preparedAvatars ?? 0}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Env files</p>
            <p className="text-sm text-slate-900">
              {envFiles.length > 0 ? envFiles.join(", ") : "none"}
            </p>
            </div>
          </div>
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">What’s failing</h3>
              {actionItems.length === 0 && missingModels.length === 0 ? (
                <p className="text-sm text-slate-600">No current issues detected.</p>
              ) : (
                <>
                  {actionItems.length > 0 && (
                    <ul className="space-y-1 text-sm text-slate-700">
                      {actionItems.map((item) => (
                        <li key={item} className="flex items-start gap-2">
                          <span className="text-emerald-600">{isReady ? "✓" : "⚠"}</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {missingModels.length > 0 && (
                    <div>
                      <p className="text-xs uppercase text-slate-500">Missing models</p>
                      <ul className="list-disc pl-6 text-sm text-slate-700">
                        {missingModels.map((model) => (
                          <li key={model}>{model}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
            <details className="rounded-md border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                Details
              </summary>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <p>
                  <span className="font-semibold text-slate-900">Repo:</span>{" "}
                  {status.resolved?.repoDir ?? "unset"}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Models:</span>{" "}
                  {status.resolved?.modelsDir ?? "unset"}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Python exe:</span>{" "}
                  {status.resolved?.python ?? "unset"}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">FFmpeg:</span>{" "}
                  {status.resolved?.ffmpegPath ?? "unset"}
                </p>
                {status.musetalk?.python?.version && (
                  <p>
                    Python {status.musetalk.python.version} (
                    {status.musetalk.python.ok ? "ok" : "broken"})
                  </p>
                )}
                {status.musetalk?.torch && (
                  <p>
                    Torch {status.musetalk.torch.version ?? "?"} · CUDA{" "}
                    {status.musetalk.torch.cudaAvailable ? "available" : "unavailable"}
                  </p>
                )}
                {status.musetalk?.mmlabImports && (
                  <div className="space-y-1">
                    {Object.entries(status.musetalk.mmlabImports).map(([key, value]) => (
                      <p key={key} className="text-xs uppercase text-slate-500">
                        {key}: {value.ok ? "ok" : "missing"} {value.version ?? ""}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={copyTemplate}
            >
              Copy .env.local template
            </button>
            {copyState === "copied" && (
              <span className="text-sm text-emerald-700">Copied!</span>
            )}
            {copyState === "failed" && (
              <span className="text-sm text-rose-600">Copy failed</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
