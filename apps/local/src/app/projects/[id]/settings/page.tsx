"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CourseVideoProject,
  GenerationSettings,
  LocalAvatarAdvancedSettings,
  AVATAR_PRESETS,
  VOICE_PRESETS,
  STYLE_PRESETS
} from "@evb/shared";
import {
  CorruptStorageError,
  getProject,
  updateProject,
  ValidationError
} from "../../../../lib/storage/projectsStore";
import SettingsForm from "../../../../components/SettingsForm";
import SettingsSummaryCard from "../../../../components/SettingsSummaryCard";
import InlineErrorBlock from "../../../../components/ui/InlineErrorBlock";
import SaveStatus from "../../../../components/ui/SaveStatus";
import LocalAvatarEngineStatusPanel from "../../../../components/LocalAvatarEngineStatusPanel";
import { fetchLocalAvatarDoctor } from "../../../../lib/localAvatarEngine";
import PrepareAvatarPanel from "../../../../components/PrepareAvatarPanel";
import { useRuntimePreviewConfig } from "../../../../lib/hooks/useRuntimePreviewConfig";
import { getPreviewGeneratorUiHints } from "../../../../lib/config/previewGeneratorConfig";

type Props = {
  params: { id: string };
};

export default function SettingsPage({ params }: Props) {
  const [project, setProject] = useState<CourseVideoProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formDetails, setFormDetails] = useState<string | null>(null);
  const [advancedDraft, setAdvancedDraft] = useState({
    avatarId: "",
    fps: "",
    bboxShift: ""
  });
  const [advancedSaveState, setAdvancedSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [localAvatarReady, setLocalAvatarReady] = useState<boolean | null>(null);
  const [cloudHealth, setCloudHealth] = useState<{
    status: "idle" | "loading" | "ok" | "error";
    statusCode?: number;
    message?: string;
  }>({ status: "idle" });
  const runtimeConfig = useRuntimePreviewConfig();
  const previewGeneratorHints = getPreviewGeneratorUiHints();
  const [settings, setSettings] = useState<GenerationSettings>({
    outputMode: "avatar_only",
    avatarPresetId: AVATAR_PRESETS[0]?.id ?? "",
    voicePresetId: VOICE_PRESETS[0]?.id ?? "",
    stylePresetId: STYLE_PRESETS[0]?.id ?? "",
    sentencesPerClip: 2,
    variationsPerSection: 1,
    updatedAt: new Date().toISOString()
  });

  useEffect(() => {
    try {
      const found = getProject(params.id);
      setProject(found);
      if (found?.generationSettings) {
        setSettings(found.generationSettings);
      }
      const advanced = found?.localAvatarAdvanced;
      setAdvancedDraft({
        avatarId: advanced?.avatarId ?? "",
        fps: advanced?.fps !== undefined ? String(advanced.fps) : "",
        bboxShift: advanced?.bboxShift !== undefined ? String(advanced.bboxShift) : ""
      });
      setAdvancedSaveState("idle");
      setAdvancedError(null);
      setError(null);
    } catch (err) {
      if (err instanceof CorruptStorageError) {
        setError(err.message);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      }
    }
  }, [params.id]);

  const cloudBaseUrl = runtimeConfig?.previewGeneratorBaseUrl ?? "";
  const cloudMissing = !cloudBaseUrl;
  const suggestedCloudBaseUrl = "http://localhost:4000";

  useEffect(() => {
    if (!cloudMissing) {
      return;
    }
    let cancelled = false;
    fetchLocalAvatarDoctor()
      .then((status) => {
        if (cancelled) {
          return;
        }
        const ready =
          status.mode === "musetalk" &&
          status.musetalk?.repoDirExists &&
          status.musetalk.python?.ok &&
          status.musetalk.torch?.ok &&
          status.musetalk.ffmpeg?.ok &&
          (status.musetalk.models?.missing?.length ?? 0) === 0;
        setLocalAvatarReady(Boolean(ready));
      })
      .catch(() => {
        if (!cancelled) {
          setLocalAvatarReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cloudMissing]);

  useEffect(() => {
    if (cloudMissing) {
      setCloudHealth({ status: "idle" });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setCloudHealth({ status: "loading" });
    fetch(`${cloudBaseUrl.replace(/\/$/, "")}/v1/health`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          setCloudHealth({ status: "ok", statusCode: res.status });
          return;
        }
        const text = await res.text();
        setCloudHealth({
          status: "error",
          statusCode: res.status,
          message: text.slice(0, 200) || `HTTP ${res.status}`
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setCloudHealth({ status: "error", message });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cloudBaseUrl, cloudMissing]);

  const handleSaved = () => {
    if (!project) {
      return;
    }
    const next = getProject(project.id);
    if (next) {
      setProject(next);
      if (next.generationSettings) {
        setSettings(next.generationSettings);
      }
    }
    setFormError(null);
    setFormDetails(null);
  };

  const handleStorageError = (message: string, details?: string) => {
    setFormError(message);
    setFormDetails(details ?? null);
  };

  const handleAdvancedSave = () => {
    if (!project) {
      return;
    }
    setAdvancedSaveState("saving");
    setAdvancedError(null);

    const avatarId = advancedDraft.avatarId.trim();
    const fpsRaw = advancedDraft.fps.trim();
    const bboxRaw = advancedDraft.bboxShift.trim();
    const next: LocalAvatarAdvancedSettings = {};

    if (avatarId) {
      next.avatarId = avatarId;
    }
    if (fpsRaw) {
      const fps = Number(fpsRaw);
      if (!Number.isFinite(fps) || fps <= 0) {
        setAdvancedError("FPS must be a positive number.");
        setAdvancedSaveState("error");
        return;
      }
      next.fps = fps;
    }
    if (bboxRaw) {
      const bboxShift = Number(bboxRaw);
      if (!Number.isFinite(bboxShift) || !Number.isInteger(bboxShift)) {
        setAdvancedError("BBox shift must be an integer.");
        setAdvancedSaveState("error");
        return;
      }
      next.bboxShift = bboxShift;
    }

    try {
      const updated = updateProject({
        id: project.id,
        localAvatarAdvanced: Object.keys(next).length > 0 ? next : undefined
      });
      setProject(updated);
      setAdvancedDraft({
        avatarId: updated.localAvatarAdvanced?.avatarId ?? "",
        fps: updated.localAvatarAdvanced?.fps !== undefined
          ? String(updated.localAvatarAdvanced.fps)
          : "",
        bboxShift: updated.localAvatarAdvanced?.bboxShift !== undefined
          ? String(updated.localAvatarAdvanced.bboxShift)
          : ""
      });
      setAdvancedSaveState("saved");
    } catch (err) {
      if (err instanceof ValidationError) {
        setAdvancedError(err.message);
        setAdvancedSaveState("error");
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setAdvancedError(message);
      setAdvancedSaveState("error");
    }
  };

  const updateAdvancedDraft = (patch: Partial<typeof advancedDraft>) => {
    setAdvancedDraft((prev) => ({ ...prev, ...patch }));
    setAdvancedSaveState("idle");
    setAdvancedError(null);
  };


  if (error) {
    return (
      <main className="section-stack">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Link className="underline hover:text-slate-700" href={`/projects/${params.id}`}>
            Back to Workspace
          </Link>
          <span className="text-slate-300">|</span>
          <Link className="underline hover:text-slate-700" href={`/projects/${params.id}#preview`}>
            Back to Preview
          </Link>
        </div>
        <Link href={`/projects/${params.id}`} className="btn-ghost w-fit">
          Back to Project
        </Link>
        <InlineErrorBlock message={error} />
      </main>
    );
  }

  if (!project) {
    return (
      <main className="section-stack">
        <Link href="/" className="btn-ghost w-fit">
          Back to Projects
        </Link>
        <section className="card space-y-2">
          <h1>Project not found</h1>
        </section>
      </main>
    );
  }

  if (!project.draftManifest) {
    return (
      <main className="section-stack">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Link className="underline hover:text-slate-700" href={`/projects/${project.id}`}>
            Back to Workspace
          </Link>
          <span className="text-slate-300">|</span>
          <Link className="underline hover:text-slate-700" href={`/projects/${project.id}#preview`}>
            Back to Preview
          </Link>
        </div>
        <Link href={`/projects/${project.id}`} className="btn-ghost w-fit">
          Back to Project
        </Link>
        <section className="card space-y-2">
          <h1>Generation Settings</h1>
          <p>Upload a .docx before configuring generation settings.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="section-stack">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Link className="underline hover:text-slate-700" href={`/projects/${project.id}`}>
          Back to Workspace
        </Link>
        <span className="text-slate-300">|</span>
        <Link className="underline hover:text-slate-700" href={`/projects/${project.id}#preview`}>
          Back to Preview
        </Link>
      </div>
      <Link href={`/projects/${project.id}`} className="btn-ghost w-fit">
        Back to Project
      </Link>
      <section className="card space-y-2">
        <h1>Generation Settings</h1>
        <p className="text-sm text-slate-600">
          Configure output and presets before generating.
        </p>
      </section>
      <SettingsSummaryCard settings={project.generationSettings} />
      <section className="card">
        <SettingsForm
          projectId={project.id}
          settings={settings}
          onChange={(next) => {
            setSettings(next);
            setFormError(null);
            setFormDetails(null);
          }}
          onSaved={handleSaved}
          onStorageError={handleStorageError}
        />
      </section>
      {formError && (
        <InlineErrorBlock message={formError} details={formDetails ?? undefined} />
      )}
      {cloudMissing && (
        <InlineErrorBlock
          message="Cloud generation is not configured."
          details={previewGeneratorHints.details}
        />
      )}
      {!cloudMissing && cloudHealth.status === "error" && (
        <InlineErrorBlock
          message="Cloud generation is not reachable."
          details={`URL: ${cloudBaseUrl}\nStatus: ${cloudHealth.statusCode ?? "n/a"}\n${cloudHealth.message ?? ""}`.trim()}
        />
      )}
      {(cloudMissing || cloudHealth.status !== "ok") && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-medium text-slate-800">Local Avatar generation</p>
          <p className="mt-1 text-xs text-slate-500">
            Use Preview to run Generate all (Local Avatar).
          </p>
          {localAvatarReady !== null && (
            <p className="mt-2 text-xs text-slate-600">
              Local Avatar: {localAvatarReady ? "Ready" : "Not ready"}
            </p>
          )}
          <Link href={`/projects/${project.id}`} className="btn-secondary mt-3 w-fit">
            Go to Preview
          </Link>
          <pre className="mt-3 whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-600">
            {`NEXT_PUBLIC_CLOUD_API_BASE_URL=${suggestedCloudBaseUrl}`}
          </pre>
        </div>
      )}
      {!cloudMissing && cloudHealth.status === "ok" && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-medium text-slate-800">Cloud generation</p>
          <p className="mt-1 text-xs text-slate-600">
            Base URL: {cloudBaseUrl}
          </p>
          <p className="mt-2 text-xs text-slate-600">
            Status: OK
          </p>
        </div>
      )}
      <LocalAvatarEngineStatusPanel />
      <PrepareAvatarPanel project={project} onProjectUpdate={setProject} />

      <section className="card space-y-4">
        <div>
          <h2>Advanced (Local MuseTalk)</h2>
          <p className="text-sm text-slate-600">
            Optional tuning for the Local (MuseTalk) avatar provider only.
          </p>
        </div>
        <div className="space-y-3">
          <div>
            <label htmlFor="localAvatarId">Avatar ID (optional)</label>
            <input
              id="localAvatarId"
              type="text"
              value={advancedDraft.avatarId}
              onChange={(event) => updateAdvancedDraft({ avatarId: event.target.value })}
            />
            <p className="helper-text">Leave blank to use the default avatar.</p>
          </div>
          <div>
            <label htmlFor="localAvatarFps">FPS (optional)</label>
            <input
              id="localAvatarFps"
              type="number"
              min={1}
              value={advancedDraft.fps}
              onChange={(event) => updateAdvancedDraft({ fps: event.target.value })}
            />
            <p className="helper-text">Recommended: 25 for realtime MuseTalk.</p>
          </div>
          <div>
            <label htmlFor="localAvatarBboxShift">BBox shift (optional)</label>
            <input
              id="localAvatarBboxShift"
              type="number"
              step={1}
              value={advancedDraft.bboxShift}
              onChange={(event) => updateAdvancedDraft({ bboxShift: event.target.value })}
            />
            <p className="helper-text">
              Integer offset to nudge the face crop center.
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-600">
          Advanced settings never store tokens. Tokens remain ENV-only.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary" onClick={handleAdvancedSave}>
            Save advanced settings
          </button>
          <SaveStatus state={advancedSaveState} />
        </div>
        {advancedError && <InlineErrorBlock message={advancedError} />}
      </section>
    </main>
  );
}
