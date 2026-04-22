'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Info, MessageSquare, Network, X } from 'lucide-react';
import { ChatPanel } from './ChatPanel';
import type { GraphLink, GraphNode } from '../types';
import { NODE_TYPE_COLORS, FALLBACK_NODE_COLOR, extractId } from '../types';

type Tab = 'info' | 'relationships' | 'chat';

type Props = {
  activeNode: GraphNode | null;
  activeNodeLinks: GraphLink[];
  nodeById: Map<string, GraphNode>;
  degree: number;
  characterNameToId: Map<string, string>;
  onSelectNode: (id: string) => void;
  onClose: () => void;
  open: boolean;
  onToggle: () => void;
};

export function DetailPanel({
  activeNode,
  activeNodeLinks,
  nodeById,
  degree,
  characterNameToId,
  onSelectNode,
  onClose,
  open,
  onToggle,
}: Props) {
  const [tab, setTab] = useState<Tab>('info');

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="pointer-events-auto absolute right-3 top-[4.5rem] z-10 flex h-10 items-center gap-1.5 rounded-xl border border-slate-800/80 bg-slate-950/85 px-3 text-xs text-slate-300 shadow-xl backdrop-blur-xl hover:text-slate-100"
      >
        <MessageSquare className="h-3.5 w-3.5 text-sky-400" />
        <span>Details</span>
      </button>
    );
  }

  return (
    <aside
      className="pointer-events-auto absolute right-3 top-[4.5rem] z-10 flex w-[22rem] flex-col overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/85 shadow-xl backdrop-blur-xl"
      style={{ maxHeight: 'calc(100vh - 7rem)' }}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-slate-800/60 px-2 py-1.5">
        <TabButton
          icon={<Info className="h-3.5 w-3.5" />}
          label="Info"
          active={tab === 'info'}
          onClick={() => setTab('info')}
        />
        <TabButton
          icon={<Network className="h-3.5 w-3.5" />}
          label="Relations"
          badge={activeNode ? activeNodeLinks.length : undefined}
          active={tab === 'relationships'}
          onClick={() => setTab('relationships')}
        />
        <TabButton
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          label="Chat"
          active={tab === 'chat'}
          onClick={() => setTab('chat')}
        />
        <div className="flex-1" />
        <button
          type="button"
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
          title="Collapse"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'info' && (
          <InfoTab node={activeNode} degree={degree} onClose={onClose} />
        )}
        {tab === 'relationships' && (
          <RelationshipsTab
            activeNode={activeNode}
            links={activeNodeLinks}
            nodeById={nodeById}
            onSelectNode={onSelectNode}
          />
        )}
        {tab === 'chat' && (
          <ChatPanel
            characterNameToId={characterNameToId}
            onMentionClick={onSelectNode}
          />
        )}
      </div>
    </aside>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition ${
        active
          ? 'bg-sky-500/15 text-sky-200'
          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
      }`}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={`rounded px-1 text-[10px] ${
            active ? 'bg-sky-500/20 text-sky-100' : 'bg-slate-800 text-slate-400'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function InfoTab({
  node,
  degree,
  onClose,
}: {
  node: GraphNode | null;
  degree: number;
  onClose: () => void;
}) {
  if (!node) {
    return (
      <div className="flex h-full min-h-[12rem] items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <Info className="mx-auto h-6 w-6 text-slate-600" />
          <p className="text-xs text-slate-400">
            Select a node on the graph to see its details.
          </p>
          <p className="text-[11px] text-slate-600">
            Or press <kbd className="rounded bg-slate-800 px-1 text-slate-400">⌘K</kbd>{' '}
            to search.
          </p>
        </div>
      </div>
    );
  }

  const color = NODE_TYPE_COLORS[node.group] ?? FALLBACK_NODE_COLOR;

  return (
    <div className="space-y-3 overflow-y-auto p-4">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 h-3 w-3 shrink-0 rounded-full ring-2 ring-slate-950"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight text-slate-50">
            {node.name}
          </h2>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-500">
            {node.group}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Connections" value={degree} />
        <Stat label="Weight" value={node.val.toFixed(0)} />
      </div>

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-md border border-slate-800 px-3 py-1.5 text-[11px] text-slate-400 hover:border-slate-700 hover:text-slate-200"
      >
        Clear selection
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function RelationshipsTab({
  activeNode,
  links,
  nodeById,
  onSelectNode,
}: {
  activeNode: GraphNode | null;
  links: GraphLink[];
  nodeById: Map<string, GraphNode>;
  onSelectNode: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    if (!activeNode) return [];
    const byType = new Map<
      string,
      Array<{ otherId: string; otherName: string; description?: string; direction: 'out' | 'in' }>
    >();
    for (const link of links) {
      const srcId = extractId(link.source);
      const tgtId = extractId(link.target);
      const isOut = srcId === activeNode.id;
      const otherId = isOut ? tgtId : srcId;
      const otherNode = nodeById.get(otherId);
      if (!otherNode) continue;
      const list = byType.get(link.type) ?? [];
      list.push({
        otherId,
        otherName: otherNode.name,
        description: link.description,
        direction: isOut ? 'out' : 'in',
      });
      byType.set(link.type, list);
    }
    return Array.from(byType.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [activeNode, links, nodeById]);

  if (!activeNode) {
    return (
      <div className="flex h-full min-h-[12rem] items-center justify-center p-6 text-center">
        <p className="text-xs text-slate-500">No active node.</p>
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="flex h-full min-h-[12rem] items-center justify-center p-6 text-center">
        <p className="text-xs text-slate-500">No relationships match current filters.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-2">
      {grouped.map(([type, items]) => (
        <div key={type} className="mb-3">
          <div className="flex items-center gap-2 px-1.5 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">
              {type}
            </span>
            <span className="text-[10px] text-slate-500">{items.length}</span>
          </div>
          <ul className="space-y-0.5">
            {items.map((item, idx) => {
              const other = nodeById.get(item.otherId);
              const color = other
                ? NODE_TYPE_COLORS[other.group] ?? FALLBACK_NODE_COLOR
                : FALLBACK_NODE_COLOR;
              return (
                <li key={`${item.otherId}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => onSelectNode(item.otherId)}
                    className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-800/60"
                  >
                    <span
                      className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-slate-100">{item.otherName}</span>
                        {item.direction === 'in' && (
                          <span className="text-[9px] uppercase text-slate-600">←</span>
                        )}
                      </div>
                      {item.description && (
                        <p className="mt-0.5 line-clamp-2 text-[10px] text-slate-500">
                          {item.description}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-slate-600 group-hover:text-slate-400" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
