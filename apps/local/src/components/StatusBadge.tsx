"use client";

import { ProjectStatus } from "@evb/shared";

type Props = {
  status: ProjectStatus;
};

export default function StatusBadge({ status }: Props) {
  let label = "Draft";
  let classes = "bg-slate-100 text-slate-700";
  if (status === "needs_approval") {
    label = "Needs approval";
    classes = "bg-amber-100 text-amber-800";
  } else if (status === "approved") {
    label = "Approved";
    classes = "bg-green-100 text-green-800";
  } else if (status === "generating") {
    label = "Generating";
    classes = "bg-blue-100 text-blue-800";
  } else if (status === "ready") {
    label = "Ready";
    classes = "bg-green-100 text-green-800";
  } else if (status === "failed") {
    label = "Failed";
    classes = "bg-red-100 text-red-800";
  }
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}
