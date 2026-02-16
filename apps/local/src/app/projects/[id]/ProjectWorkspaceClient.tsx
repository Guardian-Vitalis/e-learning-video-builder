"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ClipPlannerAvatarMode,
  ClipPlannerPreparedAvatar,
  LocalAvatarPreparedState,
  cleanupScript,
  CleanupResult,
  CourseVideoProject,
  JobArtifactsManifest,
  JobRecord
} from "@evb/shared";
import DocxUploadCard from "../../../components/DocxUploadCard";
import OutlineLayout from "../../../components/Outline/OutlineLayout";
import SectionStatsBar from "../../../components/SectionStatsBar";
import ApprovalBanner from "../../../components/ApprovalBanner";
import StatusBadge from "../../../components/StatusBadge";
import SettingsSummaryCard from "../../../components/SettingsSummaryCard";
import GeneratePanel from "../../../components/GeneratePanel";
import { CloudApiError, createGenerationJob, getJob, setCloudApiBaseUrl } from "../../../api/cloud";
import { fetchWithRetry } from "../../../lib/cloud/fetchArtifact";
import InlineErrorBlock from "../../../components/ui/InlineErrorBlock";
import { getExportJobIdFromHistory } from "../../../lib/workspace/exportJobId";
import { buildDemoDraftManifest } from "../../../lib/demo/demoContent";
import {
  CorruptStorageError,
  clearCloudOutputs,
  canGenerate,
  deleteProject,
  getProject,
  resetProjects,
  startGenerationJob,
  updateDraftSection,
  updateProject,
  getSelectedSectionCount,
  getSelectedSectionIds,
  buildOutlineDisabledIds,
  saveScriptDraft,
  discardScriptDraft
} from "../../../lib/storage/projectsStore";
import { buildTableImagesPayload } from "../../../lib/cloud/buildTableImagesPayload";
import { getEffectiveScriptForNode } from "../../../lib/script/effectiveScript";
import { buildScriptHashMetadata, computeSentenceDiff } from "../../../lib/script/scriptHashing";
import { resolveClipArtifacts } from "../../../lib/artifacts/resolveClipArtifacts";
import { getArtifactTimestamp } from "../../../lib/artifacts/getArtifactTimestamp";
import {
  buildRegenerateJobRequest,
  GenerationGateError
} from "../../../lib/generation/generationDispatch";
import { getPreviewGeneratorUiHints } from "../../../lib/config/previewGeneratorConfig";
import { useRuntimePreviewConfig } from "../../../lib/hooks/useRuntimePreviewConfig";
import { getLocalAvatarEngineUrl } from "../../../lib/localAvatarEngine";

type Props = {
  params: { id: string };
  baseUrl?: string;
};

type StatusLevel = "green" | "yellow" | "red";
type CaptionLanguage = "en" | "fr";
type ProjectWithSettings = CourseVideoProject & {
  settings?: { captionLanguage?: CaptionLanguage };
};
type PreviewProbeResult = {
  status: "idle" | "loading" | "pass" | "fail";
  statusCode?: number;
  contentType?: string | null;
  requestId?: string | null;
  message?: string | null;
  snippet?: string | null;
  acceptRanges?: string | null;
  contentLength?: string | null;
};

function statusDotClass(status: StatusLevel) {
  switch (status) {
    case "green":
      return "bg-emerald-500";
    case "yellow":
      return "bg-amber-400";
    case "red":
    default:
      return "bg-rose-500";
  }
}

function statusText(status: StatusLevel) {
  return status === "green" ? "Configured" : "Not configured";
}

function resolveArtifactUrl(baseUrl: string, artifactPath: string) {
  if (!artifactPath) {
    return "";
  }
  if (artifactPath.startsWith("http")) {
    return artifactPath;
  }
  return `${baseUrl}${artifactPath}`;
}

function buildVariationDefaults(manifest: JobArtifactsManifest) {
  const selections: Record<string, number> = {};
  manifest.sections.forEach((section) => {
    selections[section.sectionId] = 0;
  });
  return selections;
}

function buildPlaylist(
  manifest: JobArtifactsManifest,
  selections: Record<string, number>
) {
  const clips: Array<{
    id: string;
    sectionId: string;
    title?: string;
    text: string;
    mp4Path: string;
    vttPath: string;
    srtPath: string;
  }> = [];
  manifest.sections.forEach((section) => {
    const variationIndex = selections[section.sectionId] ?? 0;
    const variation = section.variations.find(
      (item) => item.variationIndex === variationIndex
    ) ?? section.variations[0];
    variation?.clips.forEach((clip) => {
      clips.push({
        id: clip.id,
        sectionId: clip.sectionId,
        title: section.title,
        text: clip.text,
        mp4Path: clip.mp4Path,
        vttPath: clip.vttPath,
        srtPath: clip.srtPath
      });
    });
  });
  return clips;
}

function preparedAvatarFromLocal(
  state: LocalAvatarPreparedState
): ClipPlannerPreparedAvatar {
  return {
    avatarId: state.avatarId,
    fps: state.fps,
    bboxShift: state.bboxShift,
    refImageDataUrl: state.refImageDataUrl ?? null
  };
}

function getSubtreeSectionIds(
  sections: NonNullable<CourseVideoProject["draftManifest"]>["sections"],
  rootId: string
) {
  const index = sections.findIndex((section) => section.id === rootId);
  if (index === -1) {
    return new Set<string>();
  }
  const rootLevel = sections[index].level;
  const ids = new Set<string>([rootId]);
  for (let i = index + 1; i < sections.length; i += 1) {
    const next = sections[i];
    if (next.level <= rootLevel) {
      break;
    }
    ids.add(next.id);
  }
  return ids;
}

export default function ProjectWorkspaceClient({ params, baseUrl }: Props) {
  const [project, setProject] = useState<ProjectWithSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCorrupt, setIsCorrupt] = useState(false);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorDetails, setSaveErrorDetails] = useState<string | null>(null);
  const [inspectorDraftText, setInspectorDraftText] = useState("");
  const [inspectorEffectiveScript, setInspectorEffectiveScript] = useState("");
  const [isInspectorDirty, setIsInspectorDirty] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [regenerateErrorDetails, setRegenerateErrorDetails] = useState<string | null>(null);
  const [scriptDiff, setScriptDiff] = useState<{
    status: "loading" | "ready" | "unavailable";
    scriptChanged: boolean | null;
    changedSentences: number | null;
  }>({ status: "unavailable", scriptChanged: null, changedSentences: null });
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [previewCopyStatus, setPreviewCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle"
  );
  const [engineCopyStatus, setEngineCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle"
  );
  const [copyAllStatus, setCopyAllStatus] = useState<"idle" | "copied" | "error">(
    "idle"
  );
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [artifactLinks, setArtifactLinks] = useState<
    Record<string, { mp4Url: string; vttUrl: string; srtUrl: string; expiresAt: string }>
  >({});
  const [artifactMessage, setArtifactMessage] = useState<string | null>(null);
  const [previewLinks, setPreviewLinks] = useState<
    Record<
      string,
      {
        mp4Url: string;
        vttUrl: string;
        srtUrl: string;
        fetchedAt: string;
        jobUpdatedAt?: string;
      }
    >
  >({});
  const [previewCaptions, setPreviewCaptions] = useState<
    Record<
      string,
      { status: "idle" | "loading" | "loaded" | "error"; text?: string; error?: string }
    >
  >({});
  const [previewArtifacts, setPreviewArtifacts] = useState<
    Record<
      string,
      Array<{
        id: string;
        kind: "clip" | "primary";
        mp4Path: string;
        vttPath?: string;
        srtPath?: string;
      }>
    >
  >({});
  const [clipManifests, setClipManifests] = useState<
    Record<string, JobArtifactsManifest>
  >({});
  const [variationSelections, setVariationSelections] = useState<
    Record<string, Record<string, number>>
  >({});
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selectedPreviewJobId, setSelectedPreviewJobId] = useState<string | null>(null);
  const [previewLoadError, setPreviewLoadError] = useState(false);
  const [previewProbe, setPreviewProbe] = useState<PreviewProbeResult>({ status: "idle" });
  const [captionTrackUrl, setCaptionTrackUrl] = useState<string | null>(null);
  const [captionLoading, setCaptionLoading] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportErrorDetails, setExportErrorDetails] = useState<string | null>(null);
  const [exportWarning, setExportWarning] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const router = useRouter();
  const clipPlannerMode: ClipPlannerAvatarMode =
    project?.clipPlanner?.avatarMode ?? "none";
  const clipPlannerPreparedAvatar =
    project?.clipPlanner?.preparedAvatar ??
    (project?.localAvatar ? preparedAvatarFromLocal(project.localAvatar) : undefined);
  const hasClipPlannerPreparedAvatar = Boolean(clipPlannerPreparedAvatar);
  const preparedAtLabel = project?.localAvatar?.lastPreparedAt
    ? new Date(project.localAvatar.lastPreparedAt).toLocaleString()
    : null;
  const captionLanguage: CaptionLanguage = project?.settings?.captionLanguage ?? "en";
  const captionLabel = captionLanguage === "fr" ? "Français" : "English";
  const draftManifest = project?.draftManifest;
  const selectedCount = draftManifest
    ? getSelectedSectionCount(draftManifest, project?.outlineDisabledIds)
    : 0;
  const totalCount = draftManifest ? draftManifest.sections.length : 0;
  const selectedSection =
    draftManifest?.sections.find((section) => section.id === selectedSectionId) ?? null;
  const effectiveCleanupMode = project?.scriptCleanupMode ??
    (project?.sourceDoc ? "deterministic" : "off");
  const cleanupEnabled = effectiveCleanupMode !== "off";
  const cleanupResult: CleanupResult | null = selectedSection
    ? cleanupScript({
        text: selectedSection.script,
        seed: `${project?.id ?? "p"}:${selectedSection.id}`,
        config: project?.cleanupConfigOverrides
      })
    : null;
  const previewGeneratorHints = getPreviewGeneratorUiHints();
  const runtimeConfig = useRuntimePreviewConfig();
  const previewGeneratorUrl = runtimeConfig?.previewGeneratorBaseUrl ?? previewGeneratorHints.baseUrl;
  const previewGeneratorLabel = previewGeneratorUrl ?? "not set";
  const previewGeneratorSource =
    runtimeConfig?.source ?? (previewGeneratorUrl ? "process_env" : "unset");
  const runtimeLocalAvatarUrl = runtimeConfig?.localAvatarEngineUrl;
  const localAvatarEngineUrl = runtimeLocalAvatarUrl ?? getLocalAvatarEngineUrl();
  const localAvatarEngineLabel = localAvatarEngineUrl || "not set";
  const cloudBaseUrlCandidate = baseUrl ?? previewGeneratorUrl ?? "";
  const cloudBaseUrl = cloudBaseUrlCandidate.replace(/\/$/, "");
  const baseUrlMissing = !cloudBaseUrl;
  const previewGeneratorConfigured = Boolean(previewGeneratorUrl);
  const hasDocx = Boolean(project?.draftManifest?.doc);
  const localStackSteps = [
    "Upload & parse a .docx.",
    "Review the outline and approve.",
    "Generate preview MP4s.",
    "Preview Local Avatar clips and export."
  ];
  const localStackNextSteps = (() => {
    if (!previewGeneratorConfigured) {
      return [
        "Start the preview generator (apps/cloud).",
        "Set NEXT_PUBLIC_EVB_PREVIEW_GENERATOR_BASE_URL, then refresh."
      ];
    }
    if (!hasDocx) {
      return ["Upload & parse a .docx to create sections."];
    }
    if ((project?.approvalStatus ?? "draft") !== "approved") {
      return [
        "Review & Approve to unlock Generate.",
        "Generate previews once approved."
      ];
    }
    if (project?.status === "generating") {
      return [
        "Generation is running. Wait for preview MP4s.",
        "Preview Local Avatar clips when ready."
      ];
    }
      return [
        "Generate previews.",
        "Preview Local Avatar clips (or upload WAV overrides).",
        "Export MP4 + captions when ready."
    ];
  })();
  const uiStatus: StatusLevel = "green";
  const previewGeneratorStatus: StatusLevel = previewGeneratorUrl ? "green" : "red";
  const localAvatarStatus: StatusLevel = runtimeLocalAvatarUrl ? "green" : "red";
  const previewGeneratorHint = previewGeneratorUrl
    ? `Configured: ${previewGeneratorUrl}`
    : "Set NEXT_PUBLIC_CLOUD_API_BASE_URL in apps/local/.env.local";
  const localAvatarHint = runtimeLocalAvatarUrl
    ? `Configured: ${runtimeLocalAvatarUrl}`
    : "Set NEXT_PUBLIC_EVB_LOCAL_AVATAR_ENGINE_URL (default http://localhost:5600)";
  const previewProbeDetails =
    previewProbe.status === "fail"
      ? [
          `status: ${previewProbe.statusCode ?? "n/a"}`,
          `content-type: ${previewProbe.contentType ?? "n/a"}`,
          previewProbe.acceptRanges ? `accept-ranges: ${previewProbe.acceptRanges}` : null,
          previewProbe.contentLength ? `content-length: ${previewProbe.contentLength}` : null,
          previewProbe.requestId ? `requestId: ${previewProbe.requestId}` : null,
          previewProbe.message ? `message: ${previewProbe.message}` : null,
          previewProbe.snippet ? `body: ${previewProbe.snippet}` : null
        ]
          .filter(Boolean)
          .join("\n")
      : null;
  const sectionCount = project?.draftManifest?.sections.length ?? 0;
  const selectedPreviewLinks = selectedPreviewJobId
    ? previewLinks[selectedPreviewJobId]
    : undefined;
  const activeManifest = selectedPreviewJobId
    ? clipManifests[selectedPreviewJobId]
    : undefined;
  const activeSelections = selectedPreviewJobId
    ? variationSelections[selectedPreviewJobId]
    : undefined;
  const playlist = activeManifest && activeSelections
    ? buildPlaylist(activeManifest, activeSelections)
    : [];
  const selectedClip =
    selectedClipId && playlist.length > 0
      ? playlist.find((clip) => clip.id === selectedClipId) ?? playlist[0]
      : playlist[0];
  const selectedArtifacts = selectedPreviewJobId
    ? previewArtifacts[selectedPreviewJobId]
    : undefined;
  const previewArtifactId = selectedClip?.id ?? selectedArtifacts?.[0]?.id ?? null;
  const previewMp4Url =
    selectedPreviewJobId && previewArtifactId
      ? `/api/generate/preview/artifacts/${encodeURIComponent(previewArtifactId)}?jobId=${encodeURIComponent(selectedPreviewJobId)}&kind=mp4`
      : undefined;
  const previewVttUrl =
    selectedPreviewJobId && selectedClip?.id && selectedClip?.vttPath
      ? `/api/generate/preview/artifacts/${encodeURIComponent(selectedClip.id)}?jobId=${encodeURIComponent(selectedPreviewJobId)}&kind=vtt`
      : undefined;
  useEffect(() => {
    if (!previewMp4Url) {
      setPreviewProbe({ status: "idle" });
      return;
    }
    let active = true;
    const controller = new AbortController();
    const probe = async () => {
      setPreviewProbe({ status: "loading" });
      try {
        const res = await fetch(previewMp4Url, {
          headers: { Range: "bytes=0-1" },
          signal: controller.signal
        });
        const contentType = res.headers.get("content-type") ?? "";
        const acceptRanges = res.headers.get("accept-ranges");
        const contentLength = res.headers.get("content-length");
        const headerRequestId =
          res.headers.get("x-request-id") ?? res.headers.get("x-requestid");
        let requestId = headerRequestId ?? null;
        let message: string | null = null;
        let snippet: string | null = null;

        if (contentType.includes("application/json")) {
          const text = await res.text();
          snippet = text.slice(0, 200);
          try {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            const parsedRequestId =
              typeof parsed.requestId === "string"
                ? parsed.requestId
                : typeof (parsed as { error?: { requestId?: unknown } }).error?.requestId === "string"
                  ? (parsed as { error?: { requestId?: string } }).error?.requestId
                  : null;
            if (parsedRequestId) {
              requestId = parsedRequestId;
            }
            const parsedMessage =
              (parsed as { error?: { message?: unknown } }).error?.message ??
              (parsed as { message?: unknown }).message ??
              null;
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
            acceptRanges,
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
          message,
          snippet,
          acceptRanges,
          contentLength
        });
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
  }, [previewMp4Url]);
  const exportJobId = getExportJobIdFromHistory(
    project?.generationHistory,
    selectedPreviewJobId
  );
  const baseSentencesPerClip = project?.generationSettings?.sentencesPerClip ?? 2;
  const baseVariationsPerSection = project?.generationSettings?.variationsPerSection ?? 1;
  const effectiveSentencesPerClip =
    project?.projectSettingsOverrides?.sentencesPerClip ?? baseSentencesPerClip;
  const effectiveVariationsPerSection =
    project?.projectSettingsOverrides?.variationsPerSection ?? baseVariationsPerSection;
  const selectedPreviewMeta = (() => {
    if (!selectedSection) {
      return null;
    }
    if (!selectedPreviewJobId || !activeManifest) {
      return { clips: [], jobId: selectedPreviewJobId ?? null };
    }
    const sectionManifest = activeManifest.sections.find(
      (section) => section.sectionId === selectedSection.id
    );
    if (!sectionManifest) {
      return { clips: [], jobId: selectedPreviewJobId };
    }
    const variationIndex = activeSelections?.[selectedSection.id] ?? 0;
    const variation =
      sectionManifest.variations.find((entry) => entry.variationIndex === variationIndex) ??
      sectionManifest.variations[0];
    const previewInfo = previewLinks[selectedPreviewJobId];
    const lastRenderedAt = getArtifactTimestamp({
      jobUpdatedAt: previewInfo?.jobUpdatedAt ?? null,
      fetchedAt: previewInfo?.fetchedAt ?? null
    });
    const usesOverlay = Boolean(project?.scriptEditsByNodeId?.[selectedSection.id]);
    const clips = (variation?.clips ?? []).map((clip, index) => ({
      id: clip.id,
      index,
      ...resolveClipArtifacts({
        baseUrl: cloudBaseUrl,
        jobId: selectedPreviewJobId,
        sectionId: clip.sectionId,
        clipId: clip.id,
        mp4Path: clip.mp4Path,
        vttPath: clip.vttPath,
        srtPath: clip.srtPath
      }),
      lastRenderedAt,
      usesOverlay
    }));
    return { clips, jobId: selectedPreviewJobId };
  })();
  const approvalStatus = project?.approvalStatus ?? "draft";
  const localAvatarPreview = (() => {
    const manifestAvatar = project?.approvedManifest?.localAvatar ?? null;
    const refImageDataUrl = project?.localAvatar?.refImageDataUrl ?? null;
    const hint = !manifestAvatar
      ? "Approve the project with Prepared Avatar selected to enable local preview."
      : !refImageDataUrl
        ? "Prepare an avatar in Settings to enable local preview."
        : null;
    return {
      config: manifestAvatar
        ? {
            avatarId: manifestAvatar.avatarId,
            fps: manifestAvatar.fps,
            bboxShift: manifestAvatar.bboxShift
          }
        : null,
      refImageDataUrl,
      hint
    };
  })();
  const isSelectedDisabled =
    selectedSection && project?.outlineDisabledIds
      ? project.outlineDisabledIds.includes(selectedSection.id)
      : false;
  const regenEligibility = project
    ? canGenerate(project)
    : { ok: false, reason: "not_approved" as const };
  const canRegenerate =
    Boolean(selectedSection) &&
    regenEligibility.ok &&
    !isSelectedDisabled &&
    !baseUrlMissing &&
    project?.status !== "generating";
  const regenerateHint = (() => {
    if (!selectedSection) {
      return "Select a section to regenerate.";
    }
    if (baseUrlMissing) {
      return "Set the cloud base URL to run regeneration.";
    }
    if (project?.status === "generating") {
      return "Wait for the current job to finish before regenerating.";
    }
    if (isSelectedDisabled) {
      return "This section is disabled. Enable it to regenerate.";
    }
    if (!regenEligibility.ok) {
      return regenEligibility.reason === "settings_incomplete"
        ? "Complete generation settings to enable regeneration."
        : "Approve the project before regenerating.";
    }
    if (approvalStatus !== "approved") {
      return "Approve the project before regenerating.";
    }
    return "";
  })();

  const runtimePreviewBaseUrl = runtimeConfig?.previewGeneratorBaseUrl;
  useEffect(() => {
    if (runtimePreviewBaseUrl) {
      setCloudApiBaseUrl(runtimePreviewBaseUrl);
      return;
    }
    if (baseUrl) {
      setCloudApiBaseUrl(baseUrl);
    }
  }, [baseUrl, runtimePreviewBaseUrl]);

  useEffect(() => {
    try {
      const found = getProject(params.id);
      setProject(found);
      setError(null);
      setIsCorrupt(false);
    } catch (err) {
      if (err instanceof CorruptStorageError) {
        setError(err.message);
        setIsCorrupt(true);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setIsCorrupt(false);
      }
    }
  }, [params.id]);

  useEffect(() => {
    if (!draftManifest || selectedSectionId) {
      return;
    }
    const first = draftManifest.sections[0];
    if (first) {
      setSelectedSectionId(first.id);
    }
  }, [draftManifest, selectedSectionId]);

  useEffect(() => {
    if (!selectedSection) {
      setInspectorDraftText("");
      setInspectorEffectiveScript("");
      setIsInspectorDirty(false);
      setRegenerateError(null);
      setRegenerateErrorDetails(null);
      setScriptDiff({ status: "unavailable", scriptChanged: null, changedSentences: null });
      return;
    }
    const effectiveScript = getEffectiveScriptForNode({
      nodeId: selectedSection.id,
      baseScript: selectedSection.script,
      scriptEditsByNodeId: project?.scriptEditsByNodeId
    });
    setInspectorEffectiveScript(effectiveScript);
    setInspectorDraftText(effectiveScript);
    setIsInspectorDirty(false);
    setRegenerateError(null);
    setRegenerateErrorDetails(null);
  }, [selectedSection?.id, selectedSection?.script, project?.scriptEditsByNodeId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedSection || !project) {
      setScriptDiff({ status: "unavailable", scriptChanged: null, changedSentences: null });
      return () => {
        cancelled = true;
      };
    }
    const approvedHash =
      project.approvedScriptHashByNodeId?.[selectedSection.id] ?? null;
    const approvedSentenceHashes =
      project.approvedSentenceHashesByNodeId?.[selectedSection.id] ?? null;
    if (!approvedHash || !approvedSentenceHashes) {
      setScriptDiff({ status: "unavailable", scriptChanged: null, changedSentences: null });
      return () => {
        cancelled = true;
      };
    }
    setScriptDiff({ status: "loading", scriptChanged: null, changedSentences: null });
    const run = async () => {
      try {
        const meta = await buildScriptHashMetadata(
          inspectorEffectiveScript,
          project.approvedScriptHashAlgo
        );
        const diff = await computeSentenceDiff(
          approvedSentenceHashes,
          inspectorEffectiveScript
        );
        if (cancelled) {
          return;
        }
        setScriptDiff({
          status: "ready",
          scriptChanged: approvedHash !== meta.scriptHash,
          changedSentences: diff.changedSentences
        });
      } catch {
        if (!cancelled) {
          setScriptDiff({ status: "unavailable", scriptChanged: null, changedSentences: null });
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    inspectorEffectiveScript,
    project,
    selectedSection?.id,
    project?.approvedScriptHashAlgo
  ]);

  useEffect(() => {
    setPreviewCaptions({});
  }, [selectedSectionId, selectedPreviewJobId]);

  const handleReset = () => {
    resetProjects();
    setProject(null);
    setIsCorrupt(false);
  };

  const handleDraftTextChange = (value: string) => {
    setInspectorDraftText(value);
    setIsInspectorDirty(value !== inspectorEffectiveScript);
  };

  const handleSaveDraft = (text: string) => {
    if (!project || !selectedSection) {
      return;
    }
    setIsDraftSaving(true);
    try {
      const next = saveScriptDraft(project.id, selectedSection.id, text);
      const nextEffectiveScript = getEffectiveScriptForNode({
        nodeId: selectedSection.id,
        baseScript: selectedSection.script,
        scriptEditsByNodeId: next.scriptEditsByNodeId
      });
      setInspectorDraftText(nextEffectiveScript);
      setInspectorEffectiveScript(nextEffectiveScript);
      setIsInspectorDirty(false);
      setProject(next);
      setSaveError(null);
      setSaveErrorDetails(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError("Unable to save draft.");
      setSaveErrorDetails(message);
    } finally {
      setIsDraftSaving(false);
    }
  };

  const handleDiscardDraft = () => {
    if (!project || !selectedSection) {
      return;
    }
    try {
      const next = discardScriptDraft(project.id, selectedSection.id);
      const nextEffectiveScript = getEffectiveScriptForNode({
        nodeId: selectedSection.id,
        baseScript: selectedSection.script,
        scriptEditsByNodeId: next.scriptEditsByNodeId
      });
      setInspectorDraftText(nextEffectiveScript);
      setInspectorEffectiveScript(nextEffectiveScript);
      setIsInspectorDirty(false);
      setProject(next);
      setSaveError(null);
      setSaveErrorDetails(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError("Unable to discard draft.");
      setSaveErrorDetails(message);
    }
  };

  const buildEffectiveSettings = () => {
    if (!project?.generationSettings) {
      return null;
    }
    return {
      ...project.generationSettings,
      sentencesPerClip:
        project.projectSettingsOverrides?.sentencesPerClip ??
        project.generationSettings.sentencesPerClip,
      variationsPerSection:
        project.projectSettingsOverrides?.variationsPerSection ??
        project.generationSettings.variationsPerSection
    };
  };

  const handleRegenerateSection = async (sectionId: string) => {
    if (!project) {
      return;
    }
    setRegenerateError(null);
    setRegenerateErrorDetails(null);
    if (baseUrlMissing) {
      setRegenerateError(previewGeneratorHints.title);
      setRegenerateErrorDetails(previewGeneratorHints.details);
      return;
    }
    const effectiveSettings = buildEffectiveSettings();
    if (!effectiveSettings) {
      setRegenerateError("Generation settings are missing.");
      setRegenerateErrorDetails("Open Settings and configure generation before regenerating.");
      return;
    }
    setIsRegenerating(true);
    try {
      let tableImagesPayload = undefined;
      if (effectiveSettings.outputMode === "avatar_plus_slides") {
        const sections =
          project.draftManifest?.sections.filter((section) => section.id === sectionId) ?? [];
        const { tableImages } = await buildTableImagesPayload({
          projectId: project.id,
          sections,
          maxImages: 25,
          maxTotalBytes: 15 * 1024 * 1024,
          maxSingleBytes: 5 * 1024 * 1024
        });
        tableImagesPayload = tableImages.length > 0 ? tableImages : undefined;
      }

      const request = buildRegenerateJobRequest({
        project,
        targetSectionIds: [sectionId],
        effectiveSettings,
        effectiveCleanupMode,
        stubAvatarStyle: project.stubAvatarStyle ?? "silhouette",
        stubBackgroundStyle: project.stubBackgroundStyle ?? "neutral",
        tableImages: tableImagesPayload
      });
      const response = await createGenerationJob(request);
      const next = startGenerationJob(
        project.id,
        response.jobId,
        response.status,
        undefined
      );
      setProject(next);
    } catch (err) {
      if (err instanceof GenerationGateError) {
        setRegenerateError(err.message);
        setRegenerateErrorDetails(null);
      } else if (err instanceof CloudApiError) {
        if (err.status === 413) {
          setRegenerateError("Upload too large for slides mode.");
          setRegenerateErrorDetails(
            err.body ||
              "Reduce the number/size of table images or switch to avatar-only mode."
          );
        } else {
          setRegenerateError(`Request failed (${err.status})`);
          setRegenerateErrorDetails(err.body || "No response body");
        }
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setRegenerateError("Cloud API unreachable.");
        setRegenerateErrorDetails(message);
      }
    } finally {
      setIsRegenerating(false);
    }
  };

  const commitSelection = (sectionId: string) => {
    setSelectedSectionId(sectionId);
    setPendingSelectionId(null);
  };

  const handleSectionSelect = (sectionId: string) => {
    if (sectionId === selectedSectionId) {
      return;
    }
    if (isInspectorDirty) {
      setPendingSelectionId(sectionId);
      return;
    }
    commitSelection(sectionId);
  };

  const handlePendingSelectionSave = () => {
    if (!pendingSelectionId) {
      return;
    }
    handleSaveDraft(inspectorDraftText);
    commitSelection(pendingSelectionId);
  };

  const handlePendingSelectionDiscard = () => {
    if (!pendingSelectionId) {
      return;
    }
    handleDiscardDraft();
    commitSelection(pendingSelectionId);
  };

  const cancelPendingSelection = () => {
    setPendingSelectionId(null);
  };

  const handleProjectUpdated = (next: CourseVideoProject) => {
    setProject(next);
  };

  const handleRefreshArtifacts = async (jobId: string) => {
    if (!cloudBaseUrl) {
      setArtifactMessage("Cloud API base URL is missing.");
      return;
    }
    setArtifactMessage(null);
    try {
      const job = await getJob(jobId);
      if (job.status !== "succeeded" || !job.artifacts) {
        setArtifactMessage("Artifacts not ready yet.");
        return;
      }
      setArtifactLinks((prev) => ({
        ...prev,
        [jobId]: {
          mp4Url: `${cloudBaseUrl}${job.artifacts.mp4Path}`,
          vttUrl: `${cloudBaseUrl}${job.artifacts.vttPath}`,
          srtUrl: `${cloudBaseUrl}${job.artifacts.srtPath}`,
          expiresAt: job.artifacts.expiresAt
        }
      }));
    } catch (err) {
      if (err instanceof CloudApiError) {
        if (err.status === 404) {
          setArtifactMessage("Job not found in cloud. It may have expired.");
        } else {
          setArtifactMessage(err.body || `status ${err.status}`);
        }
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setArtifactMessage(message);
      }
    }
  };

  const handleCopyArtifacts = async (jobId: string) => {
    const links = artifactLinks[jobId];
    if (!links) {
      setArtifactMessage("Refresh links first.");
      return;
    }
    const payload = [`MP4: ${links.mp4Url}`, `VTT: ${links.vttUrl}`, `SRT: ${links.srtUrl}`].join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      setArtifactMessage("Links copied.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setArtifactMessage(`Unable to copy links: ${message}`);
    }
  };

  const handleClearOutputs = () => {
    if (!project) {
      return;
    }
    const next = clearCloudOutputs(project.id);
    setProject(next);
    setArtifactLinks({});
    setArtifactMessage("Outputs cleared.");
  };

  const getDefaultPreviewJobId = () => {
    const history = project?.generationHistory ?? [];
    const succeeded = history.find((item) => item.status === "succeeded");
    return succeeded?.jobId ?? null;
  };

  useEffect(() => {
    if (!project) {
      return;
    }
    if (!selectedPreviewJobId) {
      setSelectedPreviewJobId(getDefaultPreviewJobId());
    }
  }, [project, selectedPreviewJobId]);

  useEffect(() => {
    if (!selectedPreviewJobId || !activeManifest) {
      return;
    }
    setVariationSelections((prev) => {
      if (prev[selectedPreviewJobId]) {
        return prev;
      }
      return {
        ...prev,
        [selectedPreviewJobId]: buildVariationDefaults(activeManifest)
      };
    });
  }, [selectedPreviewJobId, activeManifest]);

  useEffect(() => {
    if (!selectedPreviewJobId || playlist.length === 0) {
      setSelectedClipId(null);
      return;
    }
    if (!selectedClipId || !playlist.find((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(playlist[0]?.id ?? null);
    }
  }, [selectedPreviewJobId, playlist, selectedClipId]);

  const isRetryableStatus = (status: number) =>
    status === 401 || status === 403 || status === 410;

  const loadPreviewCaption = async (clipId: string, _url: string) => {
    if (!selectedPreviewJobId) {
      setPreviewCaptions((prev) => ({
        ...prev,
        [clipId]: { status: "error", error: "Preview job not selected." }
      }));
      return;
    }
    const proxyUrl = `/api/generate/preview/artifacts/${encodeURIComponent(clipId)}?jobId=${encodeURIComponent(selectedPreviewJobId)}&kind=vtt`;
    setPreviewCaptions((prev) => ({
      ...prev,
      [clipId]: { status: "loading" }
    }));
    try {
      const res = await fetchWithRetry({
        url: proxyUrl,
        refresh: async () => {
          const refreshed = await fetchJobForPreview(selectedPreviewJobId);
          if (!refreshed) {
            throw new Error("Preview job not ready.");
          }
          return refreshed;
        },
        isRetryableStatus,
        getUrlAfterRefresh: () => proxyUrl
      });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      const text = await res.text();
      setPreviewCaptions((prev) => ({
        ...prev,
        [clipId]: { status: "loaded", text }
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPreviewCaptions((prev) => ({
        ...prev,
        [clipId]: { status: "error", error: message }
      }));
    }
  };

  const fetchJobForPreview = async (jobId: string): Promise<JobRecord | null> => {
    if (!cloudBaseUrl) {
      setPreviewError("Cloud API base URL is missing.");
      return null;
    }
    setPreviewError(null);
    setPreviewLoadError(false);
    try {
      const job = await getJob(jobId);
      if (job.status !== "succeeded") {
        setPreviewError("Artifacts not ready.");
        return null;
      }
      if (!job.artifacts) {
        setPreviewError("Artifacts missing.");
        return null;
      }
      setPreviewLinks((prev) => ({
        ...prev,
        [jobId]: {
          mp4Url: `${cloudBaseUrl}${job.artifacts.mp4Path}`,
          vttUrl: `${cloudBaseUrl}${job.artifacts.vttPath}`,
          srtUrl: `${cloudBaseUrl}${job.artifacts.srtPath}`,
          fetchedAt: new Date().toISOString(),
          jobUpdatedAt: job.updatedAt
        }
      }));
      if (job.artifacts.manifestPath) {
        try {
          const res = await fetch(resolveArtifactUrl(cloudBaseUrl, job.artifacts.manifestPath), {
            cache: "no-store"
          });
          if (res.ok) {
            const manifest = (await res.json()) as JobArtifactsManifest;
            setClipManifests((prev) => ({ ...prev, [jobId]: manifest }));
          }
        } catch {
          // ignore manifest fetch errors
        }
      }
      try {
        const res = await fetch(
          `/api/generate/preview/artifacts?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = (await res.json()) as {
            artifacts?: Array<{
              id: string;
              kind: "clip" | "primary";
              mp4Path: string;
              vttPath?: string;
              srtPath?: string;
            }>;
          };
          if (data.artifacts) {
            setPreviewArtifacts((prev) => ({ ...prev, [jobId]: data.artifacts ?? [] }));
          }
        } else {
          const text = await res.text();
          let message = text || `status ${res.status}`;
          try {
            const parsed = JSON.parse(text) as {
              requestId?: string;
              error?: { message?: string };
            };
            if (parsed?.error?.message) {
              message = parsed.error.message;
              if (parsed.requestId) {
                message = `${message} (request ${parsed.requestId})`;
              }
            }
          } catch {
            // ignore parse errors
          }
          setPreviewError(`Artifacts list failed (${res.status}). ${message}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setPreviewError(`Artifacts list failed. ${message}`);
      }
      return job;
    } catch (err) {
      if (err instanceof CloudApiError) {
        if (err.status === 404) {
          setPreviewError("Job not found in cloud.");
        } else if (err.status === 409) {
          setPreviewError("Artifacts not ready.");
        } else {
          setPreviewError(err.body || `status ${err.status}`);
        }
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setPreviewError(message);
      }
      return null;
    }
  };

  const loadPreviewCaptions = async (jobId: string) => {
    if (!selectedClip?.id || !selectedClip?.vttPath) {
      return;
    }
    const vttUrl = `/api/generate/preview/artifacts/${encodeURIComponent(selectedClip.id)}?jobId=${encodeURIComponent(jobId)}&kind=vtt`;
    setCaptionLoading(true);
    setCaptionError(null);
    try {
      const res = await fetchWithRetry({
        url: vttUrl,
        refresh: async () => {
          const refreshed = await fetchJobForPreview(jobId);
          if (!refreshed || !refreshed.artifacts) {
            throw new Error("Artifacts missing");
          }
          return refreshed;
        },
        isRetryableStatus,
        getUrlAfterRefresh: () => vttUrl
      });
      if (!res.ok) {
        setCaptionTrackUrl(null);
        setCaptionError("Captions unavailable (link expired or blocked). Click Refresh.");
        setCaptionLoading(false);
        return;
      }
      const text = await res.text();
      const blobUrl = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
      setCaptionTrackUrl(blobUrl);
      setCaptionLoading(false);
    } catch {
      setCaptionTrackUrl(null);
      setCaptionError("Captions unavailable (link expired or blocked). Click Refresh.");
      setCaptionLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedPreviewJobId) {
      setCaptionTrackUrl(null);
      setCaptionError(null);
      return;
    }
    if (!selectedPreviewLinks && !activeManifest) {
      fetchJobForPreview(selectedPreviewJobId)
        .then((job) => {
          if (job?.artifacts) {
            loadPreviewCaptions(selectedPreviewJobId).catch(() => undefined);
          }
        })
        .catch(() => undefined);
      return;
    }
    loadPreviewCaptions(selectedPreviewJobId).catch(() => undefined);
  }, [
    selectedPreviewJobId,
    selectedClip?.id,
    selectedClip?.vttPath,
    activeManifest
  ]);

  const handlePreviewSelect = (jobId: string) => {
    setSelectedPreviewJobId(jobId);
    setCaptionTrackUrl(null);
    fetchJobForPreview(jobId).catch(() => undefined);
  };

  const handleOpenPreview = (_jobId: string) => {
    if (!previewMp4Url) {
      return;
    }
    window.open(previewMp4Url, "_blank", "noopener,noreferrer");
  };

  const handlePreviewError = () => {
    setPreviewLoadError(true);
  };

  const handleSelectClip = (clipId: string) => {
    setSelectedClipId(clipId);
    setCaptionTrackUrl(null);
    setPreviewLoadError(false);
  };

  const handleStepClip = (direction: "next" | "prev") => {
    if (!selectedClip || playlist.length === 0) {
      return;
    }
    const currentIndex = playlist.findIndex((clip) => clip.id === selectedClip.id);
    if (currentIndex === -1) {
      return;
    }
    const nextIndex =
      direction === "next"
        ? Math.min(playlist.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
    const next = playlist[nextIndex];
    if (next) {
      handleSelectClip(next.id);
    }
  };

  const handleVariationChange = (sectionId: string, value: number) => {
    if (!selectedPreviewJobId) {
      return;
    }
    setVariationSelections((prev) => {
      const nextForJob = { ...(prev[selectedPreviewJobId] ?? {}) };
      nextForJob[sectionId] = value;
      return { ...prev, [selectedPreviewJobId]: nextForJob };
    });
  };

  const slugify = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "") || "course-video";

  const handleExportZip = async (jobId: string) => {
    setExportStatus("Preparing export...");
    setExportError(null);
    setExportErrorDetails(null);
    setExportWarning(null);

    try {
      const url = new URL("/api/export/preview", window.location.origin);
      url.searchParams.set("jobId", jobId);
      if (project?.id) {
        url.searchParams.set("projectId", project.id);
      }
      url.searchParams.set("captionLanguage", captionLanguage);
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text();
        let message = text || `status ${res.status}`;
        try {
          const parsed = JSON.parse(text) as {
            requestId?: string;
            error?: { message?: string };
          };
          if (parsed?.error?.message) {
            message = parsed.error.message;
            if (parsed.requestId) {
              message = `${message} (request ${parsed.requestId})`;
            }
          }
        } catch {
          // ignore parse errors
        }
        setExportStatus(null);
        setExportError(`Export failed (${res.status}).`);
        setExportErrorDetails(message);
        return;
      }

      const blob = await res.blob();
      const fileName = `${slugify(project?.name ?? "course-video")}_${jobId.slice(0, 8)}.zip`;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setExportStatus("Export ready.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportStatus(null);
      setExportError("Export failed.");
      setExportErrorDetails(message);
    }
  };

  const handleDeleteProject = async () => {
    if (!project) {
      return;
    }
    if (!confirm("Delete this project locally? This cannot be undone.")) {
      return;
    }
    setDeleteError(null);
    try {
      await deleteProject(project.id);
      router.push("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDeleteError(message);
    }
  };

  const handleSectionToggle = (sectionId: string, selected: boolean) => {
    if (!project?.draftManifest) {
      return;
    }
    const updatedManifest = updateDraftSection(project.draftManifest, sectionId, {
      selected
    });
    try {
      setIsSaving(true);
      const outlineDisabledIds = buildOutlineDisabledIds(updatedManifest);
      const selectedSectionIds = getSelectedSectionIds(updatedManifest, outlineDisabledIds);
      const next = updateProject({
        id: project.id,
        draftManifest: updatedManifest,
        selectedSectionIds,
        outlineDisabledIds,
        sourceDoc: project.sourceDoc
      });
      setProject(next);
      setIsSaving(false);
      setSaveError(null);
      setSaveErrorDetails(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setIsSaving(false);
      setSaveError("Unable to save changes locally.");
      setSaveErrorDetails(message);
    }
  };

  const handleSubtreeToggle = (sectionId: string, selected: boolean) => {
    if (!project?.draftManifest) {
      return;
    }
    const subtreeIds = getSubtreeSectionIds(project.draftManifest.sections, sectionId);
    if (subtreeIds.size === 0) {
      return;
    }
    const updatedManifest = {
      ...project.draftManifest,
      sections: project.draftManifest.sections.map((section) =>
        subtreeIds.has(section.id)
          ? { ...section, selected }
          : section
      )
    };
    try {
      setIsSaving(true);
      const outlineDisabledIds = buildOutlineDisabledIds(updatedManifest);
      const selectedSectionIds = getSelectedSectionIds(updatedManifest, outlineDisabledIds);
      const next = updateProject({
        id: project.id,
        draftManifest: updatedManifest,
        selectedSectionIds,
        outlineDisabledIds,
        sourceDoc: project.sourceDoc
      });
      setProject(next);
      setIsSaving(false);
      setSaveError(null);
      setSaveErrorDetails(null);
    } catch (err) {
      setIsSaving(false);
      if (err instanceof Error) {
        setSaveError("Unable to update selection.");
        setSaveErrorDetails(err.message);
        return;
      }
      setSaveError("Unable to update selection.");
      setSaveErrorDetails(String(err));
    }
  };

  const handleCleanupModeChange = (mode: "off" | "deterministic" | "llm") => {
    if (!project) {
      return;
    }
    try {
      const next = updateProject({
        id: project.id,
        scriptCleanupMode: mode
      });
      setProject(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError("Unable to update cleanup mode.");
      setSaveErrorDetails(message);
    }
  };

  const handleClipPlannerModeChange = (mode: ClipPlannerAvatarMode) => {
    if (!project) {
      return;
    }
    if (mode === "prepared" && !hasClipPlannerPreparedAvatar) {
      return;
    }
    try {
      const next = updateProject({
        id: project.id,
        clipPlanner: {
          avatarMode: mode,
          preparedAvatar: mode === "prepared" ? clipPlannerPreparedAvatar : undefined
        }
      });
      setProject(next);
      setSaveError(null);
      setSaveErrorDetails(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError("Unable to update clip planner avatar mode.");
      setSaveErrorDetails(message);
    }
  };

  const handleCaptionLanguageChange = (language: CaptionLanguage) => {
    if (!project) {
      return;
    }
    try {
      const next = updateProject({
        id: project.id,
        settings: {
          ...(project.settings ?? {}),
          captionLanguage: language
        }
      });
      setProject(next);
      setSaveError(null);
      setSaveErrorDetails(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError("Unable to update caption language.");
      setSaveErrorDetails(message);
    }
  };

  const handleOpenClipPlannerSettings = () => {
    if (!project) {
      return;
    }
    router.push(`/projects/${project.id}/settings`);
  };

  const handleLoadDemoSections = () => {
    if (!project) {
      return;
    }
    try {
      const draftManifest = buildDemoDraftManifest(project.name);
      const updated = updateProject({ id: project.id, draftManifest });
      setProject(updated);
      setSelectedSectionId(draftManifest.sections[0]?.id ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError("Unable to load demo content.");
      setSaveErrorDetails(message);
    }
  };

  useEffect(() => {
    return () => {
      if (captionTrackUrl) {
        URL.revokeObjectURL(captionTrackUrl);
      }
    };
  }, [captionTrackUrl]);

  const handleCopyScript = async () => {
    if (!selectedSection) {
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedSection.script);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError("Unable to copy script.");
      setSaveErrorDetails(message);
    }
  };

  const handleCopySetupLines = async () => {
    try {
      await navigator.clipboard.writeText(
        [
          "NEXT_PUBLIC_CLOUD_API_BASE_URL=http://localhost:4000",
          "NEXT_PUBLIC_EVB_LOCAL_AVATAR_ENGINE_URL=http://localhost:5600"
        ].join("\n")
      );
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1500);
    } catch {
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 1500);
    }
  };

  const handleCopyPreviewUrl = async () => {
    if (!previewGeneratorUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(previewGeneratorUrl);
      setPreviewCopyStatus("copied");
      setTimeout(() => setPreviewCopyStatus("idle"), 1200);
    } catch {
      setPreviewCopyStatus("error");
      setTimeout(() => setPreviewCopyStatus("idle"), 1200);
    }
  };

  const handleCopyEngineUrl = async () => {
    if (!runtimeLocalAvatarUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(runtimeLocalAvatarUrl);
      setEngineCopyStatus("copied");
      setTimeout(() => setEngineCopyStatus("idle"), 1200);
    } catch {
      setEngineCopyStatus("error");
      setTimeout(() => setEngineCopyStatus("idle"), 1200);
    }
  };

  const handleCopyAllUrls = async () => {
    if (!previewGeneratorUrl || !runtimeLocalAvatarUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(
        [
          `PREVIEW_GENERATOR_URL=${previewGeneratorUrl}`,
          `LOCAL_AVATAR_ENGINE_URL=${runtimeLocalAvatarUrl}`
        ].join("\n")
      );
      setCopyAllStatus("copied");
      setTimeout(() => setCopyAllStatus("idle"), 1200);
    } catch {
      setCopyAllStatus("error");
      setTimeout(() => setCopyAllStatus("idle"), 1200);
    }
  };

  return (
    <main className="section-stack">
      <Link href="/" className="btn-ghost w-fit">
        Back to Projects
      </Link>
      <section className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Local MVP Start Here</h2>
            <p className="text-xs text-slate-500">Local Stack Status (MuseTalk-first).</p>
          </div>
          {!previewGeneratorConfigured && (
            <span className="rounded-full border border-amber-300 px-3 py-1 text-xs font-medium text-amber-700">
              Preview generator not configured
            </span>
          )}
        </div>
        <div className="space-y-1 text-sm text-slate-700">
          <p>UI: http://localhost:3000 (apps/local)</p>
          <p>Preview generator (apps/cloud): {previewGeneratorLabel}.</p>
          <p className="text-xs text-slate-500">Source: {previewGeneratorSource}.</p>
          <p>Local Avatar engine (apps/local-avatar-engine): {localAvatarEngineLabel}.</p>
        </div>
        {project && (
          <div className="text-xs text-slate-500">
            <span className="font-medium text-slate-700">Jump to:</span>{" "}
            <a className="underline hover:text-slate-700" href="#upload">Upload</a>{" "}
            <span className="text-slate-300">|</span>{" "}
            <Link className="underline hover:text-slate-700" href={`/projects/${project.id}/settings`}>
              Settings
            </Link>{" "}
            <span className="text-slate-300">|</span>{" "}
            <a className="underline hover:text-slate-700" href="#generate">Generate</a>{" "}
            <span className="text-slate-300">|</span>{" "}
            <a className="underline hover:text-slate-700" href="#preview">Preview</a>
          </div>
        )}
        <div className="space-y-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-slate-700">Local stack readiness</p>
            <div className="flex items-center gap-2">
              {previewGeneratorUrl && runtimeLocalAvatarUrl && (
                <button
                  type="button"
                  className="text-xs text-slate-500 underline hover:text-slate-700"
                  onClick={handleCopyAllUrls}
                >
                  {copyAllStatus === "copied"
                    ? "Copied"
                    : copyAllStatus === "error"
                      ? "Copy failed"
                      : "Copy all URLs"}
                </button>
              )}
              <button
                type="button"
                className="btn-ghost"
                onClick={handleCopySetupLines}
              >
                {copyStatus === "copied" ? "Copied" : "Copy setup lines"}
              </button>
              {copyStatus === "error" && (
                <span className="text-xs text-rose-600">Copy failed</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`mt-0.5 h-2 w-2 rounded-full ${statusDotClass(uiStatus)}`} />
            <span className="font-medium text-slate-700">UI</span>
            <span className="text-slate-500">{statusText(uiStatus)}:</span>
            <span>http://localhost:3000</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`mt-0.5 h-2 w-2 rounded-full ${statusDotClass(previewGeneratorStatus)}`} />
            <span className="font-medium text-slate-700">Preview generator</span>
            <span className="text-slate-500">{statusText(previewGeneratorStatus)}:</span>
            {previewGeneratorUrl ? (
              <>
                <span>Configured:</span>
                <a
                  className="underline hover:text-slate-700"
                  href={previewGeneratorUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {previewGeneratorUrl}
                </a>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  className="text-xs text-slate-500 underline hover:text-slate-700"
                  onClick={handleCopyPreviewUrl}
                >
                  {previewCopyStatus === "copied"
                    ? "Copied"
                    : previewCopyStatus === "error"
                      ? "Copy failed"
                      : "Copy URL"}
                </button>
              </>
            ) : (
              <span>{previewGeneratorHint}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`mt-0.5 h-2 w-2 rounded-full ${statusDotClass(localAvatarStatus)}`} />
            <span className="font-medium text-slate-700">Local Avatar engine</span>
            <span className="text-slate-500">{statusText(localAvatarStatus)}:</span>
            {runtimeLocalAvatarUrl ? (
              <>
                <span>Configured:</span>
                <a
                  className="underline hover:text-slate-700"
                  href={runtimeLocalAvatarUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {runtimeLocalAvatarUrl}
                </a>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  className="text-xs text-slate-500 underline hover:text-slate-700"
                  onClick={handleCopyEngineUrl}
                >
                  {engineCopyStatus === "copied"
                    ? "Copied"
                    : engineCopyStatus === "error"
                      ? "Copy failed"
                      : "Copy URL"}
                </button>
              </>
            ) : (
              <>
                <span>{localAvatarHint}</span>
                {project?.id && (
                  <>
                    <span className="text-slate-300">·</span>
                    <Link
                      className="underline hover:text-slate-700"
                      href={`/projects/${project.id}/settings`}
                    >
                      Open Settings
                    </Link>
                  </>
                )}
              </>
            )}
          </div>
          {(previewGeneratorUrl || runtimeLocalAvatarUrl) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">Open services:</span>
              {previewGeneratorUrl && (
                <a
                  className="underline hover:text-slate-700"
                  href={previewGeneratorUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Preview generator
                </a>
              )}
              {previewGeneratorUrl && runtimeLocalAvatarUrl && (
                <span className="text-slate-300">|</span>
              )}
              {runtimeLocalAvatarUrl && (
                <a
                  className="underline hover:text-slate-700"
                  href={runtimeLocalAvatarUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Local Avatar engine
                </a>
              )}
            </div>
          )}
        </div>
        <ol className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          {localStackSteps.map((step) => (
            <li key={step} className="rounded-md border border-slate-200 px-3 py-2">
              {step}
            </li>
          ))}
        </ol>
        <div className="text-xs text-slate-500">
          <p className="font-medium text-slate-700">What to do next</p>
          <ul className="list-disc pl-5 space-y-1">
            {localStackNextSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <details className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-800">
            Preview generator commands (apps/cloud)
          </summary>
          <ol className="mt-2 list-decimal pl-5 space-y-1 text-slate-700">
            {previewGeneratorHints.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-slate-500">
            {previewGeneratorHints.message} {previewGeneratorHints.restartHint}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Detected preview generator: {previewGeneratorLabel} (source: {previewGeneratorSource}).
          </p>
        </details>
      </section>
      {error && (
        <InlineErrorBlock
          message={error}
          actionLabel={isCorrupt ? "Reset local projects" : undefined}
          onAction={isCorrupt ? handleReset : undefined}
        />
      )}
      {!error && !project && (
        <section className="card space-y-2">
          <h1>Project not found</h1>
          <Link href="/" className="btn-secondary w-fit">
            Back to Projects
          </Link>
        </section>
      )}
      {project && (
        <>
          <section className="card space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1>{project.name}</h1>
                {project.description && (
                  <p className="mt-1 text-sm text-slate-600">
                    {project.description}
                  </p>
                )}
              </div>
              <StatusBadge status={project.status} />
            </div>
          </section>
          <section id="upload" className="scroll-mt-24">
            <DocxUploadCard
              projectId={project.id}
              project={project}
              onProjectUpdated={handleProjectUpdated}
            />
          </section>
          <div id="script-approval" className="scroll-mt-24" />
          {project.draftManifest &&
            (project.approvalStatus ?? "draft") !== "approved" && (
            <ApprovalBanner
              title="Needs approval."
              body="Review the outline and script before generation."
              ctaLabel="Review & Approve"
              ctaHref={`/projects/${project.id}/review`}
            />
          )}
          {(project.approvalStatus ?? "draft") !== "approved" &&
            project.lastApprovedAt && (
            <ApprovalBanner
              title="Edits detected."
              body="This project must be re-approved before generation."
              ctaLabel="Review & Approve"
              ctaHref={`/projects/${project.id}/review`}
            />
          )}
          {!project.draftManifest && (
            <p className="text-sm text-slate-600">
              Upload a .docx to create an outline and script.
            </p>
          )}
          {project.draftManifest && (
            <>
              <SectionStatsBar total={totalCount} selected={selectedCount} />
              {selectedCount === 0 && (
                <InlineErrorBlock message="No sections selected. Select at least one section to proceed later." />
              )}
              {saveError && (
                <InlineErrorBlock
                  message={saveError}
                  details={saveErrorDetails ?? undefined}
                  actionLabel={selectedSection ? "Copy script to clipboard" : undefined}
                  onAction={selectedSection ? handleCopyScript : undefined}
                />
              )}
                <OutlineLayout
                  sections={project.draftManifest.sections}
                  outlineDisabledIds={project.outlineDisabledIds}
                  selectedSectionId={selectedSectionId}
                  onSelect={handleSectionSelect}
                  onToggle={handleSectionToggle}
                  onToggleSubtree={handleSubtreeToggle}
                  sentencesPerClip={effectiveSentencesPerClip}
                  variationsPerSection={effectiveVariationsPerSection}
                  scriptEditsByNodeId={project.scriptEditsByNodeId}
                  draftText={inspectorDraftText}
                  onDraftTextChange={handleDraftTextChange}
                  effectiveScript={inspectorEffectiveScript}
                  onSaveDraft={handleSaveDraft}
                  onDiscardDraft={handleDiscardDraft}
                  isDraftDirty={isInspectorDirty}
                  isDraftSaving={isDraftSaving}
                  cleanupEnabled={cleanupEnabled}
                  cleanupResult={cleanupResult ?? undefined}
                  cleanupMode={effectiveCleanupMode}
                  canRegenerate={canRegenerate}
                  regenerateHint={regenerateHint}
                  onRegenerateSection={handleRegenerateSection}
                  isRegenerating={isRegenerating}
                  regenerateError={
                    regenerateError
                      ? { message: regenerateError, details: regenerateErrorDetails }
                      : undefined
                  }
                  previewClips={selectedPreviewMeta?.clips}
                  previewJobId={selectedPreviewMeta?.jobId ?? null}
                  previewCaptions={previewCaptions}
                  onLoadPreviewCaption={loadPreviewCaption}
                  localAvatarPreview={localAvatarPreview}
                  scriptDiff={scriptDiff}
                />
              <Link href={`/projects/${project.id}/review`} className="btn-secondary w-fit">
                Review &amp; Approve
              </Link>
              <SettingsSummaryCard
                settings={project.generationSettings}
                projectId={project.id}
              />
              <section className="card space-y-2">
                <h2>Captions</h2>
                <label className="grid gap-1 text-xs text-slate-600" htmlFor="caption-language">
                  Caption language
                  <select
                    id="caption-language"
                    className="rounded-md border border-slate-200 px-2 py-1 text-sm"
                    value={captionLanguage}
                    onChange={(event) =>
                      handleCaptionLanguageChange(event.target.value as CaptionLanguage)
                    }
                  >
                    <option value="en">English</option>
                    <option value="fr">Français</option>
                  </select>
                </label>
              </section>
              <section className="card space-y-3">
                <h2>Clip Planner avatar</h2>
                <p className="text-sm text-slate-600">
                  Choose how the clip planner references avatars for generation.
                </p>
                <div className="space-y-2 text-sm text-slate-700">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="clip-planner-avatar-mode"
                      value="none"
                      checked={clipPlannerMode === "none"}
                      onChange={() => handleClipPlannerModeChange("none")}
                    />
                    <span>No avatar (default)</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="clip-planner-avatar-mode"
                      value="prepared"
                      checked={clipPlannerMode === "prepared"}
                      disabled={!hasClipPlannerPreparedAvatar}
                      onChange={() => handleClipPlannerModeChange("prepared")}
                    />
                    <span>Prepared Avatar (MuseTalk)</span>
                  </label>
                </div>
                {clipPlannerMode === "prepared" && hasClipPlannerPreparedAvatar && clipPlannerPreparedAvatar && (
                  <p className="text-xs text-slate-500">
                    {clipPlannerPreparedAvatar.avatarId} · {clipPlannerPreparedAvatar.fps} fps · bbox shift{" "}
                    {clipPlannerPreparedAvatar.bboxShift}
                    {preparedAtLabel ? ` · Prepared on ${preparedAtLabel}` : ""}
                  </p>
                )}
                {!hasClipPlannerPreparedAvatar && (
                  <InlineErrorBlock
                    message="No prepared avatar found. Prepare one in Settings."
                    actionLabel="Open Settings"
                    onAction={handleOpenClipPlannerSettings}
                  />
                )}
              </section>
              <section className="card space-y-3">
                <h2>Script Cleanup</h2>
                <p className="text-sm text-slate-600">
                  Rewrite narration to be spoken-friendly before generation.
                </p>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={cleanupEnabled}
                    onChange={(event) =>
                      handleCleanupModeChange(event.target.checked ? "deterministic" : "off")
                    }
                  />
                  Use Script Cleanup
                </label>
                <label className="grid gap-1 text-xs text-slate-600" htmlFor="cleanup-mode">
                  Mode
                  <select
                    id="cleanup-mode"
                    className="rounded-md border border-slate-200 px-2 py-1 text-sm"
                    value={effectiveCleanupMode}
                    onChange={(event) =>
                      handleCleanupModeChange(event.target.value as "off" | "deterministic" | "llm")
                    }
                    disabled={!cleanupEnabled && effectiveCleanupMode === "off"}
                  >
                    <option value="deterministic">Deterministic (no keys)</option>
                    <option value="llm">Provider (LLM, requires keys)</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                {effectiveCleanupMode === "llm" && (
                  <p className="text-xs text-slate-500">
                    LLM cleanup runs server-side and requires API keys. Preview uses deterministic cleanup.
                  </p>
                )}
              </section>
              <section id="generate" className="scroll-mt-24">
                <GeneratePanel project={project} onProjectUpdated={handleProjectUpdated} />
              </section>
              <section id="preview" className="card space-y-3 scroll-mt-24">
                <h2>Preview</h2>
                {previewError && <InlineErrorBlock message={previewError} />}
                {selectedPreviewJobId ? (
                  <>
                    <p className="text-sm text-slate-600">
                      Previewing job {selectedPreviewJobId.slice(0, 8)}
                    </p>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => fetchJobForPreview(selectedPreviewJobId)}
                    >
                      Refresh preview links
                    </button>
                    {previewMp4Url && (
                      <>
                        <button
                          type="button"
                          className="btn-ghost w-fit"
                          onClick={() => handleOpenPreview(selectedPreviewJobId)}
                        >
                          Open MP4
                        </button>
                        {activeManifest && (
                          <div className="rounded-md border border-slate-200 p-3">
                            <p className="text-sm font-medium text-slate-700">
                              Playlist
                            </p>
                            <div className="mt-2 space-y-2">
                              {activeManifest.sections.map((section) => (
                                <div key={section.sectionId} className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs text-slate-500">
                                    {section.title ?? section.sectionId}
                                  </span>
                                  <select
                                    className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                                    value={(activeSelections ?? {})[section.sectionId] ?? 0}
                                    onChange={(event) =>
                                      handleVariationChange(
                                        section.sectionId,
                                        Number(event.target.value)
                                      )
                                    }
                                  >
                                    {section.variations.map((variation) => (
                                      <option key={variation.variationIndex} value={variation.variationIndex}>
                                        Variation {variation.variationIndex + 1}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ))}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => handleStepClip("prev")}
                                disabled={!selectedClip || playlist.length <= 1}
                              >
                                Prev clip
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => handleStepClip("next")}
                                disabled={!selectedClip || playlist.length <= 1}
                              >
                                Next clip
                              </button>
                            </div>
                            {playlist.length > 0 && (
                              <div className="mt-3 grid gap-2 text-xs text-slate-600">
                                {playlist.map((clip, index) => (
                                  <button
                                    key={clip.id}
                                    type="button"
                                    className={`rounded-md border px-2 py-1 text-left ${
                                      clip.id === selectedClip?.id
                                        ? "border-slate-500 text-slate-900"
                                        : "border-slate-200"
                                    }`}
                                    onClick={() => handleSelectClip(clip.id)}
                                  >
                                    Clip {index + 1}: {clip.title ?? clip.sectionId}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {previewProbe.status === "loading" && (
                          <p className="text-sm text-slate-600">
                            Checking preview stream...
                          </p>
                        )}
                        {previewProbe.status === "fail" && (
                          <InlineErrorBlock
                            title="Preview video not playable"
                            message="The preview artifact did not look like a playable MP4."
                            details={previewProbeDetails ?? undefined}
                          />
                        )}
                        {previewProbe.status === "pass" && (
                          <video
                            controls
                            preload="metadata"
                            style={{ width: "100%" }}
                            onError={handlePreviewError}
                          >
                            <source src={previewMp4Url} type="video/mp4" />
                            {(previewVttUrl || captionTrackUrl) && (
                              <track
                                key={previewVttUrl ?? captionTrackUrl ?? "captions"}
                                kind="subtitles"
                                srcLang={captionLanguage}
                                label={captionLabel}
                                src={previewVttUrl ?? captionTrackUrl ?? undefined}
                                default
                              />
                            )}
                          </video>
                        )}
                        {captionLoading && <p className="text-sm text-slate-600">Loading captions...</p>}
                        {captionError && (
                          <p className="text-sm text-slate-600">
                            Captions unavailable (link expired or blocked). Click Refresh.
                          </p>
                        )}
                        {previewLoadError && (
                          <p className="text-sm text-slate-600">
                            Preview link expired. Refresh preview links.
                          </p>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-slate-600">
                    No preview yet. Run Generate to create an export.
                  </p>
                )}
              </section>
              <section className="card space-y-3">
                <h2>Export</h2>
                <p className="text-sm text-slate-600">
                  Downloads MP4 + captions for Moodle upload.
                </p>
                <button
                  type="button"
                  className="btn-primary w-fit"
                  onClick={() => (exportJobId ? handleExportZip(exportJobId) : undefined)}
                  disabled={!exportJobId}
                >
                  Export ZIP
                </button>
                {exportStatus && <p className="text-sm text-slate-600">{exportStatus}</p>}
                {exportWarning && <p className="text-sm text-slate-600">{exportWarning}</p>}
                {exportError && (
                  <InlineErrorBlock
                    message={exportError}
                    details={exportErrorDetails ?? undefined}
                  />
                )}
              </section>
              <section className="card space-y-3">
                <h2>Artifacts</h2>
                {artifactMessage && <p className="text-sm text-slate-600">{artifactMessage}</p>}
                {project.generationHistory && project.generationHistory.length > 0 ? (
                  <>
                    <ul className="space-y-3">
                      {project.generationHistory.map((item) => {
                        const links = artifactLinks[item.jobId];
                        const isPreview = item.jobId === selectedPreviewJobId;
                        return (
                          <li key={item.jobId} className="rounded-md border border-slate-200 p-3">
                            <p className="text-sm text-slate-700">
                              Job {item.jobId.slice(0, 8)} - {item.status} -{" "}
                              {new Date(item.createdAt).toLocaleString()}
                              {isPreview ? " (Preview)" : ""}
                            </p>
                            {item.status === "succeeded" && (
                              <>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button type="button" className="btn-secondary" onClick={() => handlePreviewSelect(item.jobId)}>
                                  Preview
                                </button>
                                  <button type="button" className="btn-secondary" onClick={() => handleRefreshArtifacts(item.jobId)}>
                                  Refresh links
                                </button>
                                  <button type="button" className="btn-secondary" onClick={() => handleCopyArtifacts(item.jobId)}>
                                  Copy links
                                </button>
                                </div>
                                {links && (
                                  <ul className="mt-2 space-y-1 text-sm">
                                    <li>
                                      <a className="text-slate-700 underline hover:text-slate-900" href={links.mp4Url}>Download MP4</a>
                                    </li>
                                    <li>
                                      <a className="text-slate-700 underline hover:text-slate-900" href={links.vttUrl}>Download VTT</a>
                                    </li>
                                    <li>
                                      <a className="text-slate-700 underline hover:text-slate-900" href={links.srtUrl}>Download SRT</a>
                                    </li>
                                  </ul>
                                )}
                              </>
                            )}
                            {item.status === "failed" && (
                              <p className="mt-2 text-sm text-slate-600">Generation failed.</p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <button type="button" className="btn-secondary w-fit" onClick={handleClearOutputs}>
                      Clear outputs
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-slate-600">No exports yet.</p>
                )}
              </section>
              <section className="card space-y-2">
                <h2>Local Storage</h2>
                <p>
                  This project stores DOCX (IndexedDB) and drafts/settings/history
                  (localStorage).
                </p>
                <p className="text-sm text-slate-700">DOCX stored: {hasDocx ? "Yes" : "No"}</p>
                <p className="text-sm text-slate-700">Sections extracted: {sectionCount}</p>
                <button type="button" className="btn-secondary w-fit" onClick={handleDeleteProject}>
                  Delete project data
                </button>
                {deleteError && <InlineErrorBlock message={deleteError} />}
              </section>
            </>
          )}
          <section className="card space-y-0">
            <details className="space-y-3">
              <summary className="flex items-center justify-between text-sm font-medium text-slate-800">
                <span>Dev-only helpers (optional)</span>
                <span className="text-xs text-slate-500">Dev-only</span>
              </summary>
              <div className="space-y-2 text-sm text-slate-600">
                <p>Use this to validate the full flow quickly.</p>
                <button
                  type="button"
                  className="btn-secondary w-fit"
                  onClick={handleLoadDemoSections}
                >
                  Fill with sample sections (no DOCX)
                </button>
                <p className="text-xs text-slate-500">
                  Demo content uses placeholder DOCX metadata and is not stored in IndexedDB.
                </p>
              </div>
            </details>
          </section>
        </>
      )}
      {pendingSelectionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60">
          <div className="w-full max-w-md rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-lg">
            <p className="text-base font-medium text-slate-900">
              Unsaved changes detected
            </p>
            <p className="mt-2 text-slate-600">
              You have unsaved edits in the inspector. Save or discard before switching sections.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={isDraftSaving}
                onClick={handlePendingSelectionSave}
              >
                {isDraftSaving ? "Saving..." : "Save Draft"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handlePendingSelectionDiscard}
              >
                Discard
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={cancelPendingSelection}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
