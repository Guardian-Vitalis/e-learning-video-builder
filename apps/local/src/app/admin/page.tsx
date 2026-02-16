import { OpsClient } from "./OpsClient";
import { getPreviewGeneratorUiHints } from "../../lib/config/previewGeneratorConfig";

export default function AdminPage() {
  const previewGeneratorHints = getPreviewGeneratorUiHints();
  if (!previewGeneratorHints.configured || !previewGeneratorHints.baseUrl) {
    return (
      <main>
        <h1>Admin / Ops</h1>
        <div role="alert">
          <p>{previewGeneratorHints.title}</p>
          <p>{previewGeneratorHints.message}</p>
          <ol className="mt-2 list-decimal pl-6 text-xs text-slate-600">
            {previewGeneratorHints.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </main>
    );
  }
  const isDev = process.env.NODE_ENV !== "production";
  const baseUrl = previewGeneratorHints.baseUrl;
  return (
    <main>
      <h1>Admin / Ops</h1>
      <p className="text-xs text-slate-600">
        Preview generator: {baseUrl}. {previewGeneratorHints.restartHint}.
      </p>
      <OpsClient baseUrl={baseUrl} isDev={isDev} />
    </main>
  );
}
