"use client";

import { useState } from "react";

type Props = {
  title?: string;
  message: string;
  details?: string | null;
  actionLabel?: string;
  onAction?: () => void;
  canCopyDetails?: boolean;
};

export default function InlineErrorBlock({
  title = "Something went wrong",
  message,
  details,
  actionLabel,
  onAction,
  canCopyDetails = true
}: Props) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const handleCopy = async () => {
    if (!details) {
      return;
    }
    try {
      await navigator.clipboard.writeText(details);
      setCopyMessage("Details copied.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCopyMessage(`Copy failed: ${msg}`);
    }
  };

  return (
    <div
      role="alert"
      className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-900"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1">{message}</p>
      {(actionLabel || details) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-900 hover:bg-red-100"
            >
              {actionLabel}
            </button>
          )}
          {details && (
            <details className="w-full">
              <summary className="cursor-pointer text-xs font-medium text-red-900">
                Details
              </summary>
              <div className="mt-2 rounded border border-red-200 bg-white p-2 text-xs text-slate-700">
                <pre className="whitespace-pre-wrap">{details}</pre>
                {canCopyDetails && (
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Copy details
                    </button>
                    {copyMessage && <span>{copyMessage}</span>}
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
