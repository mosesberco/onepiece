'use client';

import type { GraphLink, GraphNode } from '../types';
import { NODE_TYPE_COLORS, FALLBACK_NODE_COLOR } from '../types';

const extractId = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'id' in v) {
    return String((v as { id: unknown }).id);
  }
  return '';
};

type Props = {
  hoveredNode: GraphNode | null;
  hoveredLink: GraphLink | null;
  nodeById: Map<string, GraphNode>;
  degree: number;
};

export function HoverCard({ hoveredNode, hoveredLink, nodeById, degree }: Props) {
  if (!hoveredNode && !hoveredLink) return null;

  return (
    <div className="pointer-events-none absolute bottom-12 left-1/2 z-10 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-slate-800/80 bg-slate-950/95 p-3 text-xs shadow-2xl backdrop-blur-xl">
      {hoveredNode ? (
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{
              backgroundColor:
                NODE_TYPE_COLORS[hoveredNode.group] ?? FALLBACK_NODE_COLOR,
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <p className="truncate text-sm font-semibold text-slate-50">
                {hoveredNode.name}
              </p>
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                {hoveredNode.group}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {degree} connection{degree === 1 ? '' : 's'} · click to focus
            </p>
          </div>
        </div>
      ) : hoveredLink ? (
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-sky-300">
              {hoveredLink.type}
            </span>
          </div>
          <p className="mt-1 text-slate-100">
            <span className="text-slate-200">
              {nodeById.get(extractId(hoveredLink.source))?.name ??
                extractId(hoveredLink.source)}
            </span>
            <span className="mx-1.5 text-slate-600">→</span>
            <span className="text-slate-200">
              {nodeById.get(extractId(hoveredLink.target))?.name ??
                extractId(hoveredLink.target)}
            </span>
          </p>
          {hoveredLink.description && (
            <p className="mt-1 line-clamp-3 text-[11px] text-slate-400">
              {hoveredLink.description}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
