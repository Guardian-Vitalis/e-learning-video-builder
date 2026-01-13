import Link from "next/link";
import { CourseVideoProject } from "@evb/shared";

type Props = {
  projects: CourseVideoProject[];
};

export default function ProjectList({ projects }: Props) {
  if (projects.length === 0) {
    return (
      <div className="card">
        <p>Create your first Course Video project.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {projects.map((project) => (
        <li key={project.id}>
          <Link
            href={`/projects/${project.id}`}
            className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="text-base font-medium text-slate-900">
              {project.name}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Updated {new Date(project.updatedAt).toLocaleDateString()}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
