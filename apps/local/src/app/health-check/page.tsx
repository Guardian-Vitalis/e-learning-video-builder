import { HealthResponse } from "@evb/shared";
import { getPreviewGeneratorBaseUrl, getPreviewGeneratorUiHints } from "../../lib/config/previewGeneratorConfig";

type HealthResult =
  | { kind: "ok"; data: HealthResponse; url: string }
  | { kind: "missing-env" }
  | { kind: "http-error"; status: number; bodySnippet: string; url: string }
  | { kind: "unreachable"; errorText: string; url: string };

async function getHealth(): Promise<HealthResult> {
  const baseUrl = getPreviewGeneratorBaseUrl();
  if (!baseUrl) {
    return { kind: "missing-env" };
  }

  const url = `${baseUrl.replace(/\/$/, "")}/v1/health`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      const bodySnippet = text.slice(0, 300);
      return { kind: "http-error", status: res.status, bodySnippet, url };
    }
    const data = (await res.json()) as HealthResponse;
    return { kind: "ok", data, url };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    return { kind: "unreachable", errorText, url };
  }
}

export default async function HealthCheckPage() {
  const result = await getHealth();
  const previewGeneratorHints = getPreviewGeneratorUiHints();

  return (
    <main>
      <h1>Health Check</h1>
      {result.kind === "missing-env" && (
        <div role="alert">
          <p>{previewGeneratorHints.title}</p>
          <p>{previewGeneratorHints.message}</p>
          <ol className="mt-2 list-decimal pl-6 text-xs text-slate-600">
            {previewGeneratorHints.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      {result.kind === "ok" && (
        <>
          <p>Preview generator: {result.url}</p>
          <p>Preview generator status: {result.data.status}</p>
        </>
      )}
      {result.kind === "http-error" && (
        <>
          <p>Preview generator returned an error.</p>
          <p>Preview generator: {result.url}</p>
          <p>Status code: {result.status}</p>
          <pre>{result.bodySnippet || "(empty response body)"}</pre>
        </>
      )}
      {result.kind === "unreachable" && (
        <>
          <p>Preview generator unreachable. Start the apps/cloud dev server and try again.</p>
          <p>Preview generator: {result.url}</p>
          <pre>{result.errorText}</pre>
        </>
      )}
    </main>
  );
}
