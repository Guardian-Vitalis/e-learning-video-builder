"use client";

type Props = {
  total: number;
  selected: number;
};

export default function SectionStatsBar({ total, selected }: Props) {
  return (
    <section className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
      <span className="font-medium text-slate-900">Sections:</span> {total}{" "}
      <span className="font-medium text-slate-900">Selected:</span> {selected}
    </section>
  );
}
