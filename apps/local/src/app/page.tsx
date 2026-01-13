"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CourseVideoProject } from "@evb/shared";
import ProjectCreateForm from "../components/ProjectCreateForm";
import ProjectList from "../components/ProjectList";
import {
  CorruptStorageError,
  createProject,
  listProjects,
  resetProjects,
  ValidationError
} from "../lib/storage/projectsStore";
import { buildDemoProjectName } from "../lib/demo/demoContent";

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<CourseVideoProject[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [isCorrupt, setIsCorrupt] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadProjects = () => {
    try {
      const items = listProjects();
      setProjects(items);
      setStorageError(null);
      setIsCorrupt(false);
    } catch (err) {
      if (err instanceof CorruptStorageError) {
        setStorageError(
          "Local project data is corrupted. Reset local projects to continue."
        );
        setIsCorrupt(true);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setStorageError(message);
        setIsCorrupt(false);
      }
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleCreate = (input: { name: string; description?: string }) => {
    try {
      const project = createProject(input);
      setFormError(null);
      setShowForm(false);
      loadProjects();
      router.push(`/projects/${project.id}`);
    } catch (err) {
      if (err instanceof ValidationError) {
        setFormError(err.message);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setFormError(message);
    }
  };

  const handleCreateDemo = () => {
    try {
      const project = createProject({ name: buildDemoProjectName() });
      setFormError(null);
      setShowForm(false);
      loadProjects();
      router.push(`/projects/${project.id}`);
    } catch (err) {
      if (err instanceof ValidationError) {
        setFormError(err.message);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setFormError(message);
    }
  };

  const handleReset = () => {
    resetProjects();
    loadProjects();
  };

  return (
    <main className="section-stack">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1>Projects</h1>
          <p className="mt-1 text-sm text-slate-600">
            Create and manage course video projects.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setShowForm((value) => !value);
            setFormError(null);
          }}
        >
          New Course Video
        </button>
      </div>
      <section className="card space-y-3">
        <div>
          <h2>Quickstart (Demo in 5 minutes)</h2>
          <p className="mt-1 text-sm text-slate-600">
            Follow the guided steps to validate the full workflow.
          </p>
        </div>
        <ol className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          <li className="rounded-md border border-slate-200 px-3 py-2">Create project</li>
          <li className="rounded-md border border-slate-200 px-3 py-2">Upload DOCX</li>
          <li className="rounded-md border border-slate-200 px-3 py-2">Approve</li>
          <li className="rounded-md border border-slate-200 px-3 py-2">Generate</li>
          <li className="rounded-md border border-slate-200 px-3 py-2">Preview</li>
          <li className="rounded-md border border-slate-200 px-3 py-2">Export ZIP</li>
        </ol>
        <button type="button" className="btn-primary w-fit" onClick={handleCreateDemo}>
          Create demo project
        </button>
      </section>
      {storageError && (
        <div className="card" role="alert">
          <p>{storageError}</p>
          {isCorrupt && (
            <button type="button" className="btn-secondary mt-3" onClick={handleReset}>
              Reset local projects
            </button>
          )}
        </div>
      )}
      {showForm && (
        <div className="card">
          <ProjectCreateForm onCreate={handleCreate} errorMessage={formError} />
        </div>
      )}
      <ProjectList projects={projects} />
    </main>
  );
}
