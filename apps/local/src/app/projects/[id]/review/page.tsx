"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CourseVideoProject } from "@evb/shared";
import ReviewSummary from "../../../../components/ReviewSummary";
import StatusBadge from "../../../../components/StatusBadge";
import InlineErrorBlock from "../../../../components/ui/InlineErrorBlock";
import {
  CorruptStorageError,
  getProject,
  approveProject,
  ValidationError,
  getSelectedSectionCount,
  resetApprovalToDraft
} from "../../../../lib/storage/projectsStore";

type Props = {
  params: { id: string };
};

export default function ReviewPage({ params }: Props) {
  const router = useRouter();
  const [project, setProject] = useState<CourseVideoProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveErrorDetails, setApproveErrorDetails] = useState<string | null>(null);

  useEffect(() => {
    try {
      const found = getProject(params.id);
      setProject(found);
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

  const handleApprove = async () => {
    if (!project) {
      return;
    }
    if (!project.draftManifest) {
      setApproveError("Upload a .docx to review and approve.");
      return;
    }
    try {
      const next = await approveProject(project.id);
      setProject(next);
      setApproveError(null);
      setApproveErrorDetails(null);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      if (err instanceof ValidationError) {
        setApproveError(err.message);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setApproveError("Unable to save changes locally.");
      setApproveErrorDetails(message);
    }
  };

  const handleResetDraft = () => {
    if (!project) {
      return;
    }
    try {
      const next = resetApprovalToDraft(project.id);
      setProject(next);
      setApproveError(null);
      setApproveErrorDetails(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setApproveError("Unable to reset approval.");
      setApproveErrorDetails(message);
    }
  };

  if (error) {
    return (
      <main className="section-stack">
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
        <Link href={`/projects/${project.id}`} className="btn-ghost w-fit">
          Back to Project
        </Link>
        <section className="card space-y-2">
          <h1>Review &amp; Approve</h1>
          <p>Upload a .docx to review and approve.</p>
        </section>
      </main>
    );
  }

  const selectedCount = getSelectedSectionCount(
    project.draftManifest,
    project.outlineDisabledIds
  );

  return (
    <main className="section-stack">
      <Link href={`/projects/${project.id}`} className="btn-ghost w-fit">
        Back to Project
      </Link>
      <section className="card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1>Review &amp; Approve</h1>
          <StatusBadge status={project.status} />
        </div>
        <p className="text-sm text-slate-600">
          Confirm the outline and selected scripts before generation.
        </p>
      </section>
      <ReviewSummary
        manifest={project.draftManifest}
        courseTitle={project.name}
        outlineDisabledIds={project.outlineDisabledIds}
      />
      {selectedCount === 0 && (
        <InlineErrorBlock message="No sections selected. Select at least one section to approve." />
      )}
      {approveError && (
        <InlineErrorBlock
          message={approveError}
          details={approveErrorDetails ?? undefined}
        />
      )}
      <button
        type="button"
        className="btn-primary w-fit"
        onClick={handleApprove}
        disabled={selectedCount === 0}
      >
        Approve for Generation
      </button>
      {(project.approvalStatus ?? "draft") === "approved" && (
        <button
          type="button"
          className="btn-secondary w-fit"
          onClick={handleResetDraft}
        >
          Reset to Draft
        </button>
      )}
    </main>
  );
}
