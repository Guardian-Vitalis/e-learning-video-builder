"use client";

import { useState } from "react";
import { CourseVideoProject, DraftManifest } from "@evb/shared";
import { extractTableImages } from "../lib/parsing/docx/extractTableImages";
import { putDocx } from "../lib/storage/docxStore";
import { deleteTableImagesForProject, putTableImage } from "../lib/storage/tableImageStore";
import { deleteProjectDocx, updateProject } from "../lib/storage/projectsStore";
import InlineErrorBlock from "./ui/InlineErrorBlock";
import { getPreviewGeneratorUiHints } from "../lib/config/previewGeneratorConfig";
import { useRuntimePreviewConfig } from "../lib/hooks/useRuntimePreviewConfig";
import { getLocalAvatarEngineUrl } from "../lib/localAvatarEngine";
import { validateDocxSize } from "../lib/docxValidation";

type Props = {
  projectId: string;
  project: CourseVideoProject;
  onProjectUpdated: (project: CourseVideoProject) => void;
};

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export default function DocxUploadCard({
  projectId,
  project,
  onProjectUpdated
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [warningDetails, setWarningDetails] = useState<string | null>(null);
  const [warningTitle, setWarningTitle] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const previewGeneratorHints = getPreviewGeneratorUiHints();
  const runtimeConfig = useRuntimePreviewConfig();
  const previewGeneratorUrl = runtimeConfig?.previewGeneratorBaseUrl ?? previewGeneratorHints.baseUrl;
  const previewGeneratorLabel = previewGeneratorUrl ?? "not set";
  const previewGeneratorSource =
    runtimeConfig?.source ?? (previewGeneratorHints.configured ? "process_env" : "unset");
  const localAvatarEngineUrl =
    runtimeConfig?.localAvatarEngineUrl ?? getLocalAvatarEngineUrl();

  const validateFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      return { title: "Invalid file", message: "Please upload a .docx Word file." };
    }
    if (file.type && file.type !== DOCX_MIME) {
      return { title: "Invalid file", message: "Please upload a .docx Word file." };
    }
    const sizeResult = validateDocxSize(file.name, file.size);
    if (sizeResult.status === "error") {
      return sizeResult;
    }
    return null;
  };

  const updateWarningState = (file: File | null) => {
    if (!file) {
      setWarning(null);
      setWarningDetails(null);
      setWarningTitle(null);
      return;
    }
    const sizeResult = validateDocxSize(file.name, file.size);
    if (sizeResult.status === "warn") {
      setWarning(sizeResult.message ?? null);
      setWarningDetails(sizeResult.details ?? null);
      setWarningTitle(sizeResult.title ?? null);
      return;
    }
    setWarning(null);
    setWarningDetails(null);
    setWarningTitle(null);
  };

  const uploadDocx = async (file: File, projectIdValue: string) => {
    const url = "/api/import/docx";
    const formData = new FormData();
    formData.append("file", file);
    formData.append("projectId", projectIdValue);
    formData.append("filename", file.name);
    const res = await fetch(url, { method: "POST", body: formData, credentials: "omit" });
    const text = await res.text();
    if (!res.ok) {
      const error = new Error("upload_failed");
      (error as { status?: number; body?: string }).status = res.status;
      (error as { status?: number; body?: string }).body = text;
      throw error;
    }
    return (text ? JSON.parse(text) : {}) as {
      title?: string;
      sections: Array<{
        sectionId: string;
        level: 1 | 2 | 3;
        heading: string;
        text: string;
      }>;
    };
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Please choose a .docx file to upload.");
      setErrorTitle(null);
      return;
    }
    const validationError = validateFile(selectedFile);
    if (validationError) {
      setError(validationError.message);
      setErrorDetails(validationError.details ?? null);
      setErrorTitle(validationError.title ?? null);
      return;
    }

    setError(null);
    setErrorDetails(null);
    setErrorTitle(null);
    setIsUploading(true);

    try {
      await deleteTableImagesForProject(projectId);
      const docMeta = await putDocx(projectId, selectedFile);
      const importResult = await uploadDocx(selectedFile, projectId);
      if (importResult.sections.length === 0) {
        throw new Error("No sections found in docx.");
      }
      const buffer = await selectedFile.arrayBuffer();
      const sections = importResult.sections.map((section) => ({
        id: section.sectionId,
        title: section.heading,
        level: section.level,
        selected: true,
        script: section.text,
        mediaRefs: []
      }));
      const selectedSectionIds = sections.map((section) => section.id);
      const { attachments, blobs } = await extractTableImages(buffer, sections);
      await Promise.all(
        Array.from(blobs.entries()).map(([attachmentId, blob]) =>
          putTableImage(projectId, attachmentId, blob)
        )
      );
      const attachmentsBySection = new Map<string, typeof attachments>();
      for (const attachment of attachments) {
        const list = attachmentsBySection.get(attachment.sectionId) ?? [];
        list.push(attachment);
        attachmentsBySection.set(attachment.sectionId, list);
      }
      const sectionsWithImages = sections.map((section) => ({
        ...section,
        tableImages: attachmentsBySection.get(section.id)
      }));
      const manifest: DraftManifest = {
        manifestVersion: "0.1",
        courseTitle: project.name,
        doc: docMeta,
        sections: sectionsWithImages
      };
      const updated = updateProject({
        id: projectId,
        draftManifest: manifest,
        sourceDoc: {
          title: importResult.title ?? project.name,
          sections: importResult.sections
        },
        selectedSectionIds,
        scriptCleanupMode: "deterministic"
      });
      onProjectUpdated(updated);
      setSelectedFile(null);
      setWarning(null);
      setWarningDetails(null);
      setWarningTitle(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("failed to fetch")) {
        setError("Could not reach the preview generator.");
        setErrorTitle("Upload failed");
        setErrorDetails(
          [
            "Ensure apps/cloud is running on http://127.0.0.1:4000.",
            `Original error: ${message}`
          ].join("\n")
        );
        return;
      }
      const errWithStatus = err as { status?: number; body?: string };
      if (errWithStatus.status && errWithStatus.body !== undefined) {
        let parsed: { code?: string; message?: string; detail?: string; upstreamUrl?: string } =
          {};
        try {
          parsed = JSON.parse(errWithStatus.body);
        } catch {
          parsed = {};
        }
        if (errWithStatus.status === 502 && parsed.code === "cloud_unreachable") {
          setError("Could not reach the preview generator.");
          setErrorTitle("Upload failed");
          setErrorDetails(
            [
              "Ensure apps/cloud is running on http://127.0.0.1:4000.",
              parsed.upstreamUrl ? `Upstream URL: ${parsed.upstreamUrl}` : null,
              parsed.detail ? `Detail: ${parsed.detail}` : null
            ]
              .filter(Boolean)
              .join("\n")
          );
          return;
        }
        if (errWithStatus.status === 400 && parsed.code === "missing_file") {
          setError("Please choose a .docx file to upload.");
          setErrorTitle("Upload failed");
          setErrorDetails(parsed.message ?? null);
          return;
        }
        setError("Cloud failed to parse this DOCX.");
        setErrorDetails(parsed.message ?? errWithStatus.body ?? `status ${errWithStatus.status}`);
        setErrorTitle("Upload failed");
        return;
      }
      if (message.toLowerCase().includes("indexeddb")) {
        setError("Unable to store this file locally. Check browser storage permissions.");
        setErrorDetails(message);
        setErrorTitle("Upload failed");
      } else {
        setError("We couldn't read this Word file. Try re-saving as .docx.");
        setErrorDetails(message);
        setErrorTitle("Upload failed");
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocx = async () => {
    if (
      !confirm(
        "Delete the uploaded DOCX? This will clear extracted sections, approvals, and outputs."
      )
    ) {
      return;
    }
    setError(null);
    setErrorDetails(null);
    setErrorTitle(null);
    try {
      const updated = await deleteProjectDocx(projectId);
      onProjectUpdated(updated);
      setSelectedFile(null);
      setWarning(null);
      setWarningDetails(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError("Unable to delete this DOCX locally.");
      setErrorDetails(message);
      setErrorTitle("Delete failed");
    }
  };

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setError(null);
    setErrorDetails(null);
    setErrorTitle(null);
    if (file) {
      const sizeResult = validateDocxSize(file.name, file.size);
      if (sizeResult.status === "error") {
        setError(sizeResult.message ?? "File is too large.");
        setErrorDetails(sizeResult.details ?? null);
        setErrorTitle(sizeResult.title ?? null);
      } else {
        updateWarningState(file);
      }
    } else {
      updateWarningState(file);
    }
  };

  const doc = project.draftManifest?.doc;

  return (
    <section className="card space-y-4">
      <div>
        <h2>Upload .docx</h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload a Word document to generate an outline and scripts.
        </p>
      </div>
      {doc ? (
        <div className="space-y-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-medium text-slate-900">{doc.fileName}</p>
            <p>Size: {(doc.fileSize / 1024).toFixed(1)} KB</p>
            <p>Last modified: {new Date(doc.lastModified).toLocaleDateString()}</p>
            <p>Stored: {new Date(doc.storedAt).toLocaleString()}</p>
          </div>
          <div>
            <label htmlFor="docx-replace">Replace .docx</label>
            <input
              id="docx-replace"
              type="file"
              accept=".docx"
              onChange={onChange}
              className="mt-2 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" onClick={handleUpload} disabled={isUploading}>
              {isUploading ? "Parsing..." : "Upload"}
            </button>
            <button type="button" className="btn-secondary" onClick={handleDeleteDocx}>
              Delete uploaded DOCX
            </button>
          </div>
          {!previewGeneratorUrl && (
            <p className="text-xs text-slate-500">
              Preview generator not configured — set NEXT_PUBLIC_CLOUD_API_BASE_URL to enable DOCX parsing.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor="docx-upload">Choose .docx</label>
            <input
              id="docx-upload"
              type="file"
              accept=".docx"
              onChange={onChange}
              className="mt-2 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
            />
          </div>
          <button type="button" className="btn-primary" onClick={handleUpload} disabled={isUploading}>
            {isUploading ? "Parsing..." : "Upload"}
          </button>
          {!previewGeneratorUrl && (
            <p className="text-xs text-slate-500">
              Preview generator not configured — set NEXT_PUBLIC_CLOUD_API_BASE_URL to enable DOCX parsing.
            </p>
          )}
        </div>
      )}
      {error && (
        <InlineErrorBlock
          title={errorTitle ?? undefined}
          message={error}
          details={errorDetails ?? undefined}
        />
      )}
      {!error && warning && (
        <InlineErrorBlock
          title={warningTitle ?? undefined}
          message={warning}
          details={warningDetails ?? undefined}
        />
      )}
      <p className="text-xs text-slate-500">
        Preview generator: {previewGeneratorLabel} (source: {previewGeneratorSource}).
      </p>
      <p className="text-xs text-slate-500">
        Local Avatar engine: {localAvatarEngineUrl}.
      </p>
    </section>
  );
}
