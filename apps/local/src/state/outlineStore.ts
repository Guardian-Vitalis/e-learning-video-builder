"use client";

import { useEffect, useRef, useState } from "react";
import type { OutlineNodeVM } from "../lib/outline/outlineSelectors";

export type OutlineStoreState = {
  query: string;
  selectedOnly: boolean;
  collapsedIds: Set<string>;
};

type OutlineStoreOptions = {
  defaultCollapsedDepth?: number;
};

export function useOutlineStore(nodes: OutlineNodeVM[], options?: OutlineStoreOptions) {
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const defaultCollapsedDepth = options?.defaultCollapsedDepth ?? 2;
  const initializedRef = useRef(false);
  const lastKeyRef = useRef("");

  useEffect(() => {
    const nextKey = nodes.map((node) => node.id).join("|");
    if (initializedRef.current && nextKey === lastKeyRef.current) {
      return;
    }
    if (nodes.length === 0) {
      return;
    }
    const next = new Set<string>();
    nodes.forEach((node) => {
      if (node.hasChildren && node.depth >= defaultCollapsedDepth) {
        next.add(node.id);
      }
    });
    setCollapsedIds(next);
    initializedRef.current = true;
    lastKeyRef.current = nextKey;
  }, [nodes, defaultCollapsedDepth]);

  useEffect(() => {
    const validIds = new Set(nodes.map((node) => node.id));
    setCollapsedIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        }
      });
      return next;
    });
  }, [nodes]);

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => setCollapsedIds(new Set());
  const collapseAll = () => {
    const next = new Set(nodes.filter((node) => node.hasChildren).map((node) => node.id));
    setCollapsedIds(next);
  };

  return {
    query,
    setQuery,
    selectedOnly,
    setSelectedOnly,
    collapsedIds,
    toggleCollapsed,
    expandAll,
    collapseAll
  };
}
