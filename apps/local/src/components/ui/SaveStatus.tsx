"use client";

type Props = {
  state: "idle" | "saving" | "saved" | "error";
  errorLabel?: string;
};

export default function SaveStatus({ state, errorLabel }: Props) {
  if (state === "idle") {
    return null;
  }

  const label =
    state === "saving"
      ? "Saving"
      : state === "saved"
        ? "Saved"
        : errorLabel ?? "Save failed";

  const colorClass =
    state === "error" ? "text-red-600" : "text-slate-600";

  return <span className={`text-xs ${colorClass}`}>{label}</span>;
}
