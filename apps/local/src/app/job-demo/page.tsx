import JobDemoClient from "./JobDemoClient";
import { getPreviewGeneratorUiHints } from "../lib/config/previewGeneratorConfig";

export default function JobDemoPage() {
  const previewGeneratorHints = getPreviewGeneratorUiHints();
  if (!previewGeneratorHints.configured || !previewGeneratorHints.baseUrl) {
    return (
      <main>
        <h1>Job Demo</h1>
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

  return <JobDemoClient baseUrl={previewGeneratorHints.baseUrl} />;
}
