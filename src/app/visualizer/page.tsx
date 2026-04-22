'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { useGraphView } from './useGraphView';
import { GraphCanvas } from './components/GraphCanvas';
import { TopBar } from './components/TopBar';
import { FilterRail } from './components/FilterRail';
import { DetailPanel } from './components/DetailPanel';
import { SearchCommand } from './components/SearchCommand';
import { HoverCard } from './components/HoverCard';
import type { GraphData, GraphLink } from './types';

const GRAPH_REFRESH_INTERVAL_MS = 60 * 1000;

export default function VisualizerPage() {
  const [allData, setAllData] = useState<GraphData>({ nodes: [], links: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<GraphLink | null>(null);
  const [detailOpen, setDetailOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const isFirstLoadRef = useRef(true);

  const view = useGraphView(allData);

  useEffect(() => {
    const sync = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const loadGraph = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (isFirstLoadRef.current && !silent) setIsLoading(true);
    if (!silent) setError(null);
    try {
      const res = await fetch('/api/graph', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      const payload = (await res.json()) as GraphData;
      setAllData(payload);
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : 'Unknown error loading graph');
      } else {
        console.warn('Background refresh failed:', e);
      }
    } finally {
      isFirstLoadRef.current = false;
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    const id = window.setInterval(
      () => void loadGraph({ silent: true }),
      GRAPH_REFRESH_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [loadGraph]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape' && !searchOpen) {
        if (view.activeNodeId) view.goBack();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen, view]);

  const characterNameToId = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of allData.nodes) {
      if (n.group === 'Character') m.set(n.name.toLowerCase(), n.id);
    }
    return m;
  }, [allData.nodes]);

  const relTypeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of allData.links) m.set(l.type, (m.get(l.type) ?? 0) + 1);
    return m;
  }, [allData.links]);

  const nodeTypeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of allData.nodes) m.set(n.group, (m.get(n.group) ?? 0) + 1);
    return m;
  }, [allData.nodes]);

  const hoveredNode = hoveredNodeId
    ? view.nodeById.get(hoveredNodeId) ?? null
    : null;
  const hoveredDegree = hoveredNodeId ? view.degreeMap.get(hoveredNodeId) ?? 0 : 0;
  const activeDegree = view.activeNodeId
    ? view.degreeMap.get(view.activeNodeId) ?? 0
    : 0;

  const handleNodeClick = useCallback(
    (id: string) => {
      view.selectNode(id);
      setDetailOpen(true);
    },
    [view],
  );

  const handleHomeClick = useCallback(() => {
    view.clearActive();
    view.setMode('constellation');
  }, [view]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#05070c] text-slate-100">
      <GraphCanvas
        data={view.visibleData}
        width={viewport.width}
        height={viewport.height}
        mode={view.mode}
        activeNodeId={view.activeNodeId}
        hoveredNodeId={hoveredNodeId}
        onNodeHover={setHoveredNodeId}
        onLinkHover={setHoveredLink}
        onNodeClick={handleNodeClick}
        onBackgroundClick={() => {
          setHoveredNodeId(null);
          setHoveredLink(null);
        }}
        degreeMap={view.degreeMap}
      />

      <TopBar
        mode={view.mode}
        onModeChange={view.setMode}
        history={view.history}
        nodeById={view.nodeById}
        onJumpTo={view.jumpTo}
        onHome={handleHomeClick}
        onOpenSearch={() => setSearchOpen(true)}
        nodeCount={view.visibleData.nodes.length}
        linkCount={view.visibleData.links.length}
      />

      <FilterRail
        relationshipTypes={view.relationshipTypes}
        disabledRelTypes={view.disabledRelTypes}
        onToggleRelType={view.toggleRelType}
        onSetAllRelTypes={view.setAllRelTypes}
        nodeTypes={view.nodeTypes}
        disabledNodeTypes={view.disabledNodeTypes}
        onToggleNodeType={view.toggleNodeType}
        relTypeCounts={relTypeCounts}
        nodeTypeCounts={nodeTypeCounts}
      />

      <DetailPanel
        activeNode={view.activeNode}
        activeNodeLinks={view.activeNodeLinks}
        nodeById={view.nodeById}
        degree={activeDegree}
        characterNameToId={characterNameToId}
        onSelectNode={handleNodeClick}
        onClose={view.clearActive}
        open={detailOpen}
        onToggle={() => setDetailOpen((v) => !v)}
      />

      <HoverCard
        hoveredNode={hoveredNode}
        hoveredLink={hoveredLink}
        nodeById={view.nodeById}
        degree={hoveredDegree}
      />

      <SearchCommand
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        nodes={allData.nodes}
        degreeMap={view.degreeMap}
        onSelect={handleNodeClick}
      />

      <ModeHint mode={view.mode} hasActive={!!view.activeNodeId} />

      {isLoading && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/90 px-4 py-3 text-sm text-slate-200">
            <LoaderCircle className="h-4 w-4 animate-spin text-sky-400" />
            Loading graph...
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="max-w-md rounded-lg border border-rose-500/40 bg-slate-900/95 px-4 py-3 text-sm text-rose-200">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              Unable to load graph
            </div>
            <p className="text-rose-100/90">{error}</p>
          </div>
        </div>
      )}
    </main>
  );
}

function ModeHint({ mode, hasActive }: { mode: string; hasActive: boolean }) {
  const hint =
    mode === 'constellation'
      ? 'Showing top hubs. Click a node or search to dive in.'
      : mode === 'explorer' && !hasActive
        ? 'Pick a node to explore its neighborhood.'
        : mode === 'explorer'
          ? 'Click a neighbor to travel. Esc to go back.'
          : 'Everything visible. Spotlight follows your viewport.';

  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-slate-800/60 bg-slate-950/80 px-3 py-1 text-[11px] text-slate-400 backdrop-blur-xl">
      {hint}
    </div>
  );
}
