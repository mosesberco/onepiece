'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { GraphNode } from '../types';
import { NODE_TYPE_COLORS, FALLBACK_NODE_COLOR } from '../types';

type Props = {
  open: boolean;
  onClose: () => void;
  nodes: GraphNode[];
  degreeMap: Map<string, number>;
  onSelect: (nodeId: string) => void;
};

export function SearchCommand({ open, onClose, nodes, degreeMap, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const scored = nodes.map((node) => {
      const name = node.name.toLowerCase();
      let score = 0;
      if (q) {
        if (name === q) score = 1000;
        else if (name.startsWith(q)) score = 500;
        else if (name.includes(q)) score = 200;
        else return null;
      }
      score += Math.log2((degreeMap.get(node.id) ?? 0) + 1);
      return { node, score };
    });
    return scored
      .filter((r): r is { node: GraphNode; score: number } => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((r) => r.node);
  }, [degreeMap, nodes, query]);

  useEffect(() => {
    if (cursor >= results.length) setCursor(0);
  }, [cursor, results.length]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[cursor];
      if (picked) {
        onSelect(picked.id);
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/70 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-800 bg-slate-900/95 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-800/80 px-4 py-3">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search characters, locations, organizations..."
            className="flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          <kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            esc
          </kbd>
        </div>

        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-slate-500">
              No matches.
            </li>
          )}
          {results.map((node, idx) => {
            const active = idx === cursor;
            const color = NODE_TYPE_COLORS[node.group] ?? FALLBACK_NODE_COLOR;
            const degree = degreeMap.get(node.id) ?? 0;
            return (
              <li key={node.id}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(idx)}
                  onClick={() => {
                    onSelect(node.id);
                    onClose();
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                    active ? 'bg-slate-800/80' : 'hover:bg-slate-800/40'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="flex-1 truncate text-slate-100">{node.name}</span>
                  <span className="text-[11px] uppercase tracking-wide text-slate-500">
                    {node.group}
                  </span>
                  <span className="text-[11px] text-slate-600">{degree}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between border-t border-slate-800/80 px-4 py-2 text-[11px] text-slate-500">
          <span>
            <kbd className="rounded bg-slate-800 px-1 text-slate-400">↑</kbd>{' '}
            <kbd className="rounded bg-slate-800 px-1 text-slate-400">↓</kbd> navigate
          </span>
          <span>
            <kbd className="rounded bg-slate-800 px-1 text-slate-400">↵</kbd> open
          </span>
        </div>
      </div>
    </div>
  );
}
