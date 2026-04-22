'use client';

import { useState } from 'react';
import { ChevronDown, Eye, EyeOff, SlidersHorizontal } from 'lucide-react';
import { NODE_TYPE_COLORS, FALLBACK_NODE_COLOR } from '../types';

type Props = {
  relationshipTypes: string[];
  disabledRelTypes: Set<string>;
  onToggleRelType: (type: string) => void;
  onSetAllRelTypes: (disabled: boolean) => void;

  nodeTypes: string[];
  disabledNodeTypes: Set<string>;
  onToggleNodeType: (type: string) => void;

  relTypeCounts: Map<string, number>;
  nodeTypeCounts: Map<string, number>;
};

export function FilterRail({
  relationshipTypes,
  disabledRelTypes,
  onToggleRelType,
  onSetAllRelTypes,
  nodeTypes,
  disabledNodeTypes,
  onToggleNodeType,
  relTypeCounts,
  nodeTypeCounts,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  return (
    <aside
      className={`pointer-events-auto absolute left-3 top-[4.5rem] z-10 flex flex-col overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/85 shadow-xl backdrop-blur-xl transition-all ${
        expanded ? 'w-64' : 'w-11'
      }`}
      style={{ maxHeight: 'calc(100vh - 7rem)' }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex h-10 shrink-0 items-center gap-2 border-b border-slate-800/60 px-3 text-xs font-semibold uppercase tracking-wider text-slate-300 hover:bg-slate-900/60"
      >
        <SlidersHorizontal className="h-3.5 w-3.5 text-sky-400" />
        {expanded && <span className="flex-1 text-left">Filters</span>}
        {expanded && <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
      </button>

      {expanded && (
        <div className="flex-1 overflow-y-auto">
          <Section title="Node types">
            <ul className="space-y-0.5">
              {nodeTypes.map((type) => {
                const disabled = disabledNodeTypes.has(type);
                const color = NODE_TYPE_COLORS[type] ?? FALLBACK_NODE_COLOR;
                const count = nodeTypeCounts.get(type) ?? 0;
                return (
                  <li key={type}>
                    <button
                      type="button"
                      onClick={() => onToggleNodeType(type)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition ${
                        disabled
                          ? 'text-slate-600'
                          : 'text-slate-200 hover:bg-slate-800/60'
                      }`}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: disabled ? '#334155' : color,
                        }}
                      />
                      <span className="flex-1 text-left">{type}</span>
                      <span className="text-[10px] text-slate-500">{count}</span>
                      {disabled ? (
                        <EyeOff className="h-3 w-3" />
                      ) : (
                        <Eye className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section
            title="Relationships"
            action={
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => onSetAllRelTypes(false)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                >
                  all
                </button>
                <button
                  type="button"
                  onClick={() => onSetAllRelTypes(true)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                >
                  none
                </button>
              </div>
            }
          >
            <ul className="space-y-0.5">
              {relationshipTypes.map((type) => {
                const disabled = disabledRelTypes.has(type);
                const count = relTypeCounts.get(type) ?? 0;
                return (
                  <li key={type}>
                    <button
                      type="button"
                      onClick={() => onToggleRelType(type)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition ${
                        disabled
                          ? 'text-slate-600'
                          : 'text-slate-200 hover:bg-slate-800/60'
                      }`}
                    >
                      <span className="flex-1 truncate text-left font-mono text-[11px]">
                        {type}
                      </span>
                      <span className="text-[10px] text-slate-500">{count}</span>
                      {disabled ? (
                        <EyeOff className="h-3 w-3" />
                      ) : (
                        <Eye className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        </div>
      )}
    </aside>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-800/40 px-2 py-2.5 last:border-b-0">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}
