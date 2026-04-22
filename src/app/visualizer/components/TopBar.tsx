'use client';

import { ChevronRight, Home, Network, Search } from 'lucide-react';
import type { GraphNode, ViewMode } from '../types';
import { VIEW_MODE_LABELS } from '../types';

type Props = {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  history: string[];
  nodeById: Map<string, GraphNode>;
  onJumpTo: (index: number) => void;
  onHome: () => void;
  onOpenSearch: () => void;
  nodeCount: number;
  linkCount: number;
};

const MODES: ViewMode[] = ['constellation', 'explorer', 'freeform'];

export function TopBar({
  mode,
  onModeChange,
  history,
  nodeById,
  onJumpTo,
  onHome,
  onOpenSearch,
  nodeCount,
  linkCount,
}: Props) {
  return (
    <header className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-800/60 bg-slate-950/80 px-4 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-slate-100">
        <Network className="h-4 w-4 text-sky-400" />
        <span className="text-sm font-semibold tracking-tight">One Piece Atlas</span>
        <span className="ml-1 rounded-md bg-slate-800/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
          {nodeCount}N · {linkCount}E
        </span>
      </div>

      <div className="mx-2 h-5 w-px bg-slate-800" />

      <button
        type="button"
        onClick={onHome}
        className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-slate-300 hover:bg-slate-800/70"
        title="Return to overview"
      >
        <Home className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Home</span>
      </button>

      {history.length > 0 && (
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs text-slate-400">
          {history.map((id, idx) => {
            const node = nodeById.get(id);
            const label = node?.name ?? id;
            const isLast = idx === history.length - 1;
            return (
              <div key={`${id}-${idx}`} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-slate-600" />
                <button
                  type="button"
                  onClick={() => onJumpTo(idx)}
                  className={`max-w-[140px] truncate rounded px-1.5 py-0.5 ${
                    isLast
                      ? 'bg-sky-500/15 text-sky-200'
                      : 'text-slate-300 hover:bg-slate-800/70'
                  }`}
                >
                  {label}
                </button>
              </div>
            );
          })}
        </nav>
      )}

      {history.length === 0 && <div className="flex-1" />}

      <button
        type="button"
        onClick={onOpenSearch}
        className="flex h-8 items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-2.5 text-xs text-slate-400 hover:border-slate-700 hover:text-slate-200"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden md:inline">Search</span>
        <kbd className="hidden rounded bg-slate-800 px-1 py-0.5 text-[10px] text-slate-400 md:inline">
          ⌘K
        </kbd>
      </button>

      <div className="flex items-center rounded-md border border-slate-800 bg-slate-900/60 p-0.5">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`rounded px-2.5 py-1 text-[11px] font-medium capitalize transition ${
              mode === m
                ? 'bg-sky-500/15 text-sky-200'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title={VIEW_MODE_LABELS[m].hint}
          >
            {VIEW_MODE_LABELS[m].title}
          </button>
        ))}
      </div>
    </header>
  );
}
