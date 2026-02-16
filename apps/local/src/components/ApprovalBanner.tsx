"use client";

import Link from "next/link";

type Props = {
  title: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
};

export default function ApprovalBanner({ title, body, ctaLabel, ctaHref }: Props) {
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-amber-900">{body}</p>
      {ctaLabel && ctaHref && (
        <Link href={ctaHref} className="btn-ghost mt-3 w-fit text-amber-900">
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
