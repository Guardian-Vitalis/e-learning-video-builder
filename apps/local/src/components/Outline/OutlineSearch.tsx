"use client";

type Props = {
  query: string;
  selectedOnly: boolean;
  onQueryChange: (value: string) => void;
  onSelectedOnlyChange: (value: boolean) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
};

export default function OutlineSearch({
  query,
  selectedOnly,
  onQueryChange,
  onSelectedOnlyChange,
  onExpandAll,
  onCollapseAll
}: Props) {
  return (
    <div className="space-y-2">
      <label className="grid gap-1 text-xs text-slate-600" htmlFor="outline-search">
        Search
        <input
          id="outline-search"
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search outline"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={(event) => onSelectedOnlyChange(event.target.checked)}
          />
          Selected only
        </label>
        <button type="button" className="btn-ghost" onClick={onExpandAll}>
          Expand all
        </button>
        <button type="button" className="btn-ghost" onClick={onCollapseAll}>
          Collapse all
        </button>
      </div>
    </div>
  );
}
