import ProjectWorkspaceClient from "./ProjectWorkspaceClient";

type Props = {
  params: { id: string };
};

export default function ProjectWorkspacePage({ params }: Props) {
  const baseUrl = process.env.NEXT_PUBLIC_CLOUD_API_BASE_URL;
  return <ProjectWorkspaceClient params={params} baseUrl={baseUrl} />;
}
