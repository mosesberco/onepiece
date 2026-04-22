'use client';

import dynamic from 'next/dynamic';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle, Maximize2, Minimize2, Network, Send } from 'lucide-react';
import type { ForceGraphMethods } from 'react-force-graph-2d';
import { forceCollide } from 'd3-force';
import { askGraphQuestion } from '@/app/actions/chat';

type GraphNode = {
  id: string;
  name: string;
  label: string;
};

type GraphLink = {
  source: string;
  target: string;
  type: string;
  description?: string;
  curvature?: number;
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type ForceNode = {
  id?: string | number;
  x?: number;
  y?: number;
  [key: string]: unknown;
};

type ForceLink = {
  source?: string | number | ForceNode;
  target?: string | number | ForceNode;
  [key: string]: unknown;
};

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
});

const CORE_LABEL_COLORS: Record<string, string> = {
  Character: '#facc15',
  Location: '#38bdf8',
  Organization: '#ef4444',
  Chapter: '#a78bfa',
};
const LABEL_TEXT_COLORS: Record<string, string> = {
  Character: '#2dd4bf',
  Location: '#fb923c',
  Organization: '#c084fc',
  Chapter: '#a78bfa',
};
const EXTRA_LABEL_COLORS = [
  '#22d3ee',
  '#34d399',
  '#fb7185',
  '#f59e0b',
  '#818cf8',
  '#f472b6',
  '#2dd4bf',
  '#f97316',
];

const FALLBACK_NODE_COLOR = '#94a3b8';
const MIN_LABEL_SCALE = 1.2;
const MIN_NODE_RADIUS = 3.8;
const MAX_NODE_RADIUS = 11;
const NODE_LABEL_SCREEN_FONT_SIZE = 8;
const HIGHLIGHT_NODE_LABEL_SCREEN_FONT_SIZE = 9;
const LINK_LABEL_SCREEN_FONT_SIZE = 6;
const GRAPH_REFRESH_INTERVAL_MS = 60 * 1000;
const INITIAL_FOCUS_ZOOM = 2.1;
const HIGHWAY_EDGE_TYPES = new Set(['MEMBER_OF', 'ALLIED_WITH', 'RELATED_TO']);
const REGIONAL_EDGE_TYPES = new Set(['OPPOSES', 'DEFEATED', 'LOCATED_IN']);
const DETAILED_FAINT_EDGE_TYPES = new Set(['ATTACKED', 'ACQUIRED']);
const REGIONAL_HIGHLIGHT_TYPES = new Set(['OPPOSES', 'ALLIED_WITH', 'DEFEATED']);
const MAJOR_ORGANIZATION_NAMES = new Set(['marines', 'straw hat pirates']);
const PRIMARY_CHARACTER_NAMES = ['monkey d. luffy', 'roronoa zoro', 'nami', 'sanji', 'usopp'];
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const getLodStage = (zoomLevel: number): 'global' | 'regional' | 'micro' => {
  if (zoomLevel < 0.8) return 'global';
  if (zoomLevel < 2.0) return 'regional';
  return 'micro';
};

const isEdgeVisibleAtLod = (
  edgeType: string,
  lodStage: 'global' | 'regional' | 'micro',
): boolean => {
  const normalizedType = edgeType.toUpperCase();
  if (lodStage === 'micro') {
    return true;
  }
  if (lodStage === 'regional') {
    return (
      HIGHWAY_EDGE_TYPES.has(normalizedType) ||
      REGIONAL_EDGE_TYPES.has(normalizedType) ||
      DETAILED_FAINT_EDGE_TYPES.has(normalizedType)
    );
  }
  return HIGHWAY_EDGE_TYPES.has(normalizedType);
};

const getEdgeStyleAtLod = (
  edgeType: string,
  lodStage: 'global' | 'regional' | 'micro',
): { alpha: number; width: number } => {
  const normalizedType = edgeType.toUpperCase();

  if (lodStage === 'global') {
    return { alpha: 0.4, width: 2 };
  }

  if (lodStage === 'regional') {
    if (HIGHWAY_EDGE_TYPES.has(normalizedType)) {
      return { alpha: 0.2, width: 1.1 };
    }
    if (REGIONAL_HIGHLIGHT_TYPES.has(normalizedType)) {
      return { alpha: 0.18, width: 0.95 };
    }
    if (REGIONAL_EDGE_TYPES.has(normalizedType)) {
      return { alpha: 0.14, width: 0.8 };
    }
    if (normalizedType === 'APPEARED_IN') {
      return { alpha: 0.05, width: 0.55 };
    }
    return { alpha: 0.08, width: 0.6 };
  }

  return { alpha: 0.1, width: 0.75 };
};

export default function VisualizerPage() {
  const graphRef = useRef<ForceGraphMethods<ForceNode, ForceLink> | undefined>(undefined);
  const [allData, setAllData] = useState<GraphData>({ nodes: [], links: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [graphPadding, setGraphPadding] = useState(3.2);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isChatCompact, setIsChatCompact] = useState(false);
  const [isChatMinimized, setIsChatMinimized] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<GraphLink | null>(null);
  const [disabledRelationshipTypes, setDisabledRelationshipTypes] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: makeId(),
      role: 'assistant',
      content:
        'Ask anything about the story graph. Example: Who is Luffy role model? or Which locations appear early in the story?',
    },
  ]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const isFirstLoadRef = useRef(true);
  const hasInitialFocusRef = useRef(false);
  const pendingZoomFrameRef = useRef<number | null>(null);
  const latestZoomRef = useRef(1);

  useEffect(() => {
    const syncViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  const loadGraph = useCallback(async (options?: { silent?: boolean }) => {
    const isSilentRefresh = options?.silent ?? false;

    if (isFirstLoadRef.current && !isSilentRefresh) {
      setIsLoading(true);
    }

    if (!isSilentRefresh) {
      setError(null);
    }

    try {
      const response = await fetch('/api/graph', { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as GraphData;
      setAllData(payload);
    } catch (fetchError) {
      if (!isSilentRefresh) {
        const message =
          fetchError instanceof Error
            ? fetchError.message
            : 'Unknown error while fetching graph';
        setError(message);
      } else {
        console.warn('Background graph refresh failed:', fetchError);
      }
    } finally {
      isFirstLoadRef.current = false;
      if (!isSilentRefresh) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadGraph({ silent: true });
    }, GRAPH_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [loadGraph]);

  const characterNodeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of allData.nodes) {
      if (node.label === 'Character') {
        map.set(node.name.toLowerCase(), node.id);
      }
    }
    return map;
  }, [allData.nodes]);

  const relationshipTypes = useMemo(() => {
    return Array.from(new Set(allData.links.map((link) => link.type))).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [allData.links]);

  useEffect(() => {
    setDisabledRelationshipTypes((previous) =>
      previous.filter((type) => relationshipTypes.includes(type)),
    );
  }, [relationshipTypes]);

  const disabledRelationshipTypeSet = useMemo(
    () => new Set(disabledRelationshipTypes),
    [disabledRelationshipTypes],
  );

  const degreeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of allData.links) {
      map.set(link.source, (map.get(link.source) ?? 0) + 1);
      map.set(link.target, (map.get(link.target) ?? 0) + 1);
    }
    return map;
  }, [allData.links]);

  const topConnectedNodeIds = useMemo(() => {
    return new Set(
      Array.from(degreeMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 16)
        .map(([nodeId]) => nodeId),
    );
  }, [degreeMap]);

  const visualData = useMemo<GraphData>(() => {
    return {
      nodes: allData.nodes,
      links: allData.links.map((link) => ({ ...link, curvature: 0.2 })),
    };
  }, [allData]);

  const primaryNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of visualData.nodes) {
      const normalizedName = node.name.toLowerCase();
      if (PRIMARY_CHARACTER_NAMES.some((name) => normalizedName.includes(name))) {
        ids.add(node.id);
      }
    }
    return ids;
  }, [visualData.nodes]);

  const majorEntityNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of visualData.nodes) {
      const normalizedName = node.name.toLowerCase();
      const degree = degreeMap.get(node.id) ?? 0;
      const isMajorCharacter = node.label === 'Character' && degree >= 8;
      const isMajorOrganization =
        node.label === 'Organization' && MAJOR_ORGANIZATION_NAMES.has(normalizedName);
      if (isMajorCharacter || isMajorOrganization || PRIMARY_CHARACTER_NAMES.some((name) => normalizedName.includes(name))) {
        ids.add(node.id);
      }
    }
    return ids;
  }, [degreeMap, visualData.nodes]);

  const nodeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of visualData.nodes) {
      map.set(node.id, node.name);
    }
    return map;
  }, [visualData.nodes]);

  const nodeLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of visualData.nodes) {
      map.set(node.id, node.label);
    }
    return map;
  }, [visualData.nodes]);

  const lodStage = useMemo(() => getLodStage(zoomLevel), [zoomLevel]);

  const visibleLinks = useMemo(() => {
    return visualData.links.filter(
      (link) =>
        isEdgeVisibleAtLod(link.type, lodStage) &&
        !disabledRelationshipTypeSet.has(link.type),
    );
  }, [disabledRelationshipTypeSet, lodStage, visualData.links]);

  const visibleLinkIds = useMemo(() => {
    return new Set(visibleLinks.map((link) => `${link.source}|${link.type}|${link.target}`));
  }, [visibleLinks]);

  const focusedNodeId = hoveredNodeId ?? highlightedNodeId;

  const focusConnectedNodeIds = useMemo(() => {
    if (!focusedNodeId) {
      return new Set<string>();
    }
    const set = new Set<string>([focusedNodeId]);
    for (const link of visibleLinks) {
      const sourceId = String(link.source);
      const targetId = String(link.target);
      if (sourceId === focusedNodeId || targetId === focusedNodeId) {
        set.add(sourceId);
        set.add(targetId);
      }
    }
    return set;
  }, [focusedNodeId, visibleLinks]);

  const focusConnectedLinkIds = useMemo(() => {
    if (!focusedNodeId) {
      return new Set<string>();
    }
    const set = new Set<string>();
    for (const link of visibleLinks) {
      const sourceId = String(link.source);
      const targetId = String(link.target);
      if (sourceId === focusedNodeId || targetId === focusedNodeId) {
        set.add(`${sourceId}|${link.type}|${targetId}`);
      }
    }
    return set;
  }, [focusedNodeId, visibleLinks]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || visualData.links.length === 0) {
      return;
    }

    const chargeStrength = -420 * graphPadding;

    const chargeForce = graph.d3Force('charge') as
      | { strength?: (value: number) => unknown }
      | undefined;
    chargeForce?.strength?.(chargeStrength);

    const linkForce = graph.d3Force('link') as
      | {
          distance?: (distanceFn: (link: ForceLink) => number) => unknown;
          strength?: (strengthFn: (link: ForceLink) => number) => unknown;
        }
      | undefined;
    linkForce?.distance?.((link: ForceLink) => {
      const sourceNode =
        typeof link.source === 'object' && link.source !== null
          ? (link.source as ForceNode)
          : undefined;
      const targetNode =
        typeof link.target === 'object' && link.target !== null
          ? (link.target as ForceNode)
          : undefined;
      const sourceId = String(sourceNode?.id ?? link.source);
      const targetId = String(targetNode?.id ?? link.target);
      const relationshipType = String((link as GraphLink).type ?? '').toUpperCase();
      if (relationshipType === 'MEMBER_OF' || relationshipType === 'RELATED_TO') {
        return 30 * graphPadding;
      }
      if (relationshipType === 'ATTACKED' || relationshipType === 'APPEARED_IN') {
        return 150 * graphPadding;
      }
      if (HIGHWAY_EDGE_TYPES.has(relationshipType)) {
        return 55 * graphPadding;
      }
      return 100 * graphPadding;
    });

    linkForce?.strength?.((link: ForceLink) => {
      const relationshipType = String((link as GraphLink).type ?? '').toUpperCase();
      if (relationshipType === 'MEMBER_OF' || relationshipType === 'RELATED_TO') {
        return 0.22;
      }
      if (relationshipType === 'ATTACKED' || relationshipType === 'APPEARED_IN') {
        return 0.03;
      }
      return 0.07;
    });

    graph.d3Force(
      'collide',
      forceCollide<ForceNode>().radius((node: ForceNode) => {
        const nodeId = String(node.id ?? '');
        const degree = degreeMap.get(nodeId) ?? 0;
        const label = nodeLabelById.get(nodeId);
        let radius = 5 + Math.min(8, Math.log2(degree + 1) * 2.2);
        if (label === 'Chapter') {
          radius *= 0.72;
        }
        return radius + 2.8;
      }),
    );

    graph.d3ReheatSimulation();
  }, [degreeMap, graphPadding, nodeLabelById, visualData.links]);

  const labelColorMap = useMemo(() => {
    const labels = Array.from(new Set(allData.nodes.map((node) => node.label))).sort();
    const map = new Map<string, string>();
    let colorIndex = 0;

    for (const label of labels) {
      const predefined = CORE_LABEL_COLORS[label];
      if (predefined) {
        map.set(label, predefined);
        continue;
      }
      map.set(label, EXTRA_LABEL_COLORS[colorIndex % EXTRA_LABEL_COLORS.length]);
      colorIndex += 1;
    }

    return map;
  }, [allData.nodes]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isChatLoading]);

  useEffect(() => {
    return () => {
      if (pendingZoomFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingZoomFrameRef.current);
      }
    };
  }, []);

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = chatInput.trim();
    if (!question || isChatLoading) {
      return;
    }

    setMessages((previous) => [
      ...previous,
      { id: makeId(), role: 'user', content: question },
    ]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const result = await askGraphQuestion(question);
      setMessages((previous) => [
        ...previous,
        { id: makeId(), role: 'assistant', content: result.answer },
      ]);
    } catch (chatError) {
      const message =
        chatError instanceof Error ? chatError.message : 'Chat failed unexpectedly.';
      setMessages((previous) => [
        ...previous,
        {
          id: makeId(),
          role: 'assistant',
          content: `I could not answer that question: ${message}`,
        },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const renderAssistantMessage = (content: string) => {
    const mentionPattern = /\[\[([^[\]]+)\]\]/g;
    const parts: Array<string | { mention: string }> = [];
    let cursor = 0;

    for (const match of content.matchAll(mentionPattern)) {
      const full = match[0];
      const mention = match[1];
      const index = match.index ?? 0;
      if (index > cursor) {
        parts.push(content.slice(cursor, index));
      }
      parts.push({ mention });
      cursor = index + full.length;
    }

    if (cursor < content.length) {
      parts.push(content.slice(cursor));
    }

    if (parts.length === 0) {
      return content;
    }

    return parts.map((part, index) => {
      if (typeof part === 'string') {
        return <span key={`${index}-${part.slice(0, 10)}`}>{part}</span>;
      }

      const nodeId = characterNodeMap.get(part.mention.toLowerCase());
      if (!nodeId) {
        return (
          <span key={`${index}-${part.mention}`} className="font-medium text-sky-300">
            {part.mention}
          </span>
        );
      }

      return (
        <button
          key={`${index}-${part.mention}`}
          type="button"
          onClick={() => setHighlightedNodeId(nodeId)}
          className="mx-0.5 rounded bg-sky-500/20 px-1.5 py-0.5 font-medium text-sky-200 hover:bg-sky-500/30"
        >
          {part.mention}
        </button>
      );
    });
  };

  const legendEntries = useMemo(
    () =>
      Array.from(labelColorMap.entries()).map(([label, color]) => ({
        label,
        color,
      })),
    [labelColorMap],
  );

  const isNodeVisibleForZoom = (nodeId: string): boolean => {
    return true;
  };

  const isNodeVisibleForCurrentView = (nodeId: string): boolean => {
    if (primaryNodeIds.has(nodeId)) {
      return true;
    }
    return isNodeVisibleForZoom(nodeId);
  };

  const chatWidthClass = isChatMinimized
    ? 'sm:w-[220px]'
    : isChatCompact
      ? 'sm:w-[280px]'
      : 'sm:w-[360px]';

  const toggleRelationshipType = (type: string) => {
    setDisabledRelationshipTypes((previous) =>
      previous.includes(type)
        ? previous.filter((current) => current !== type)
        : [...previous, type],
    );
  };

  const focusedRelationshipDetails = useMemo(() => {
    if (!focusedNodeId) {
      return [];
    }
    return visibleLinks
      .filter((link) => String(link.source) === focusedNodeId || String(link.target) === focusedNodeId)
      .slice(0, 12)
      .map((link) => {
        const sourceId = String(link.source);
        const targetId = String(link.target);
        const sourceName = nodeNameById.get(sourceId) ?? sourceId;
        const targetName = nodeNameById.get(targetId) ?? targetId;
        const chapterContext = [sourceName, targetName].find((name) =>
          name.toLowerCase().includes('chapter'),
        );
        return {
          sourceName,
          targetName,
          type: link.type,
          description: link.description,
          chapterContext: chapterContext ?? null,
        };
      });
  }, [focusedNodeId, nodeNameById, visibleLinks]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-stretch gap-3 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:p-6">
        <div className="pointer-events-auto rounded-xl border border-slate-700/60 bg-slate-900/80 px-3 py-2.5 shadow-xl backdrop-blur sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-sky-400" />
            <h1 className="text-sm font-semibold tracking-wide text-slate-100">
              One Piece Knowledge Graph
            </h1>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {visualData.nodes.length} visible nodes | {visualData.links.length} links
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Total: {allData.nodes.length} nodes</p>
          <p className="mt-1 text-[11px] text-slate-500">
            Scroll to zoom, drag nodes to adjust spacing
          </p>
        </div>

        <div className="pointer-events-auto rounded-xl border border-slate-700/60 bg-slate-900/80 px-3 py-2.5 shadow-xl backdrop-blur sm:px-4 sm:py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Node Labels
          </p>
          <ul className="space-y-1 text-xs">
            {legendEntries.map((entry) => (
              <li key={entry.label} className="flex items-center gap-2 text-slate-200">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                {entry.label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="pointer-events-auto absolute left-2 right-2 top-[10.5rem] z-10 rounded-xl border border-slate-700/60 bg-slate-900/80 px-3 py-2.5 shadow-xl backdrop-blur sm:left-4 sm:right-auto sm:top-36 sm:w-[min(360px,calc(100vw-2rem))] sm:px-4 sm:py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Relationship Types
          </p>
          <p className="text-[11px] text-slate-500">
            {relationshipTypes.length - disabledRelationshipTypes.length}/{relationshipTypes.length}{' '}
            shown
          </p>
        </div>
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={() => setDisabledRelationshipTypes([])}
            className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
          >
            Show all
          </button>
          <button
            type="button"
            onClick={() => setDisabledRelationshipTypes([...relationshipTypes])}
            className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
          >
            Hide all
          </button>
        </div>
        <div className="max-h-24 space-y-1 overflow-y-auto pr-1 text-xs sm:max-h-40">
          {relationshipTypes.map((type) => {
            const checked = !disabledRelationshipTypeSet.has(type);
            return (
              <label
                key={type}
                className="flex cursor-pointer items-center justify-between rounded px-1 py-1 text-slate-200 hover:bg-slate-800/70"
              >
                <span className="mr-2 truncate">{type}</span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleRelationshipType(type)}
                  className="accent-sky-400"
                />
              </label>
            );
          })}
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/70">
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-slate-200">
            <LoaderCircle className="h-4 w-4 animate-spin text-sky-400" />
            Loading graph data...
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="max-w-md rounded-lg border border-rose-500/40 bg-slate-900/95 px-4 py-3 text-sm text-rose-200">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              Unable to load graph
            </div>
            <p className="text-rose-100/90">{error}</p>
          </div>
        </div>
      )}

      <ForceGraph2D
        ref={graphRef}
        width={viewport.width}
        height={viewport.height}
        graphData={visualData}
        backgroundColor="#020617"
        cooldownTicks={360}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.16}
        onEngineStop={() => {
          if (hasInitialFocusRef.current) {
            return;
          }
          const luffyNode = visualData.nodes.find((node) =>
            node.name.toLowerCase().includes('luffy'),
          ) as (GraphNode & { x?: number; y?: number }) | undefined;
          if (!luffyNode || luffyNode.x === undefined || luffyNode.y === undefined) {
            return;
          }
          graphRef.current?.centerAt(luffyNode.x, luffyNode.y, 900);
          graphRef.current?.zoom(INITIAL_FOCUS_ZOOM, 900);
          latestZoomRef.current = INITIAL_FOCUS_ZOOM;
          setZoomLevel(INITIAL_FOCUS_ZOOM);
          hasInitialFocusRef.current = true;
        }}
        onZoom={(transform) => {
          latestZoomRef.current = transform.k;
          if (pendingZoomFrameRef.current !== null) {
            return;
          }
          pendingZoomFrameRef.current = window.requestAnimationFrame(() => {
            pendingZoomFrameRef.current = null;
            setZoomLevel(latestZoomRef.current);
          });
        }}
        onZoomEnd={() => {
          if (pendingZoomFrameRef.current !== null) {
            window.cancelAnimationFrame(pendingZoomFrameRef.current);
            pendingZoomFrameRef.current = null;
          }
          setZoomLevel(latestZoomRef.current);
        }}
        onBackgroundClick={() => {
          setHighlightedNodeId(null);
          setHoveredNodeId(null);
          setHoveredLink(null);
        }}
        onNodeClick={(node) => {
          setHighlightedNodeId(String((node as GraphNode).id));
          setHoveredNodeId(null);
          setHoveredLink(null);
        }}
        onNodeHover={(node) => {
          setHoveredNodeId(node ? String((node as GraphNode).id) : null);
        }}
        onLinkHover={(link) => {
          setHoveredLink(link ? (link as GraphLink) : null);
        }}
        nodeLabel={(node) => `${node.name} (${node.label})`}
        nodeVisibility={(node) => isNodeVisibleForCurrentView(String((node as GraphNode).id))}
        nodeAutoColorBy={undefined}
        nodeColor={(node) =>
          labelColorMap.get((node as GraphNode).label) ?? FALLBACK_NODE_COLOR
        }
        nodeCanvasObject={(node, ctx, globalScale) => {
          const graphNode = node as GraphNode & { x: number; y: number };
          const color = labelColorMap.get(graphNode.label) ?? FALLBACK_NODE_COLOR;
          const isHighlighted = highlightedNodeId === graphNode.id;
          const isHovered = hoveredNodeId === graphNode.id;
          const isTopConnected = topConnectedNodeIds.has(graphNode.id);
          const isFocusConnected =
            !focusedNodeId || focusConnectedNodeIds.has(graphNode.id) || primaryNodeIds.has(graphNode.id);
          const nodeAlpha = focusedNodeId ? (isFocusConnected ? 1 : 0.2) : 1;
          const degree = degreeMap.get(graphNode.id) ?? 0;
          const safeScale = Number.isFinite(globalScale) && globalScale > 0 ? globalScale : 1;
          const degreeBoost = Math.min(8, Math.log2(degree + 1) * 2.3);
          let baseRadius = 6 + degreeBoost;
          if (graphNode.label === 'Chapter') {
            baseRadius *= 0.72;
          }
          if (isTopConnected) {
            baseRadius += 1.8;
          }
          if (isHighlighted) {
            baseRadius += 2.8;
          }
          const radius = Math.min(
            MAX_NODE_RADIUS,
            Math.max(MIN_NODE_RADIUS, baseRadius / Math.sqrt(safeScale)),
          );

          ctx.beginPath();
          ctx.arc(graphNode.x, graphNode.y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = color;
          ctx.globalAlpha = nodeAlpha;
          ctx.fill();
          ctx.globalAlpha = 1;

          if (isHighlighted || isTopConnected) {
            ctx.beginPath();
            ctx.arc(graphNode.x, graphNode.y, radius + 2.5, 0, 2 * Math.PI, false);
            ctx.strokeStyle = isHighlighted
              ? 'rgba(186, 230, 253, 0.95)'
              : 'rgba(251, 191, 36, 0.85)';
            ctx.lineWidth = isHighlighted ? 1.7 : 1.2;
            ctx.stroke();
          }

          const chapterLabelScale = 2.6;
          const shouldShowLabel =
            isHighlighted ||
            isHovered ||
            (focusedNodeId !== null &&
              isTopConnected &&
              (graphNode.label === 'Chapter'
                ? globalScale >= chapterLabelScale
                : globalScale >= MIN_LABEL_SCALE));

          if (shouldShowLabel) {
            const desiredScreenFontSize = isHighlighted
              ? HIGHLIGHT_NODE_LABEL_SCREEN_FONT_SIZE
              : graphNode.label === 'Chapter'
                ? NODE_LABEL_SCREEN_FONT_SIZE - 1.5
                : NODE_LABEL_SCREEN_FONT_SIZE;
            const fontSize = desiredScreenFontSize / safeScale;
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = isHighlighted
              ? '#f8fafc'
              : LABEL_TEXT_COLORS[graphNode.label] ?? '#e2e8f0';
            ctx.globalAlpha = focusedNodeId ? (isFocusConnected ? 1 : 0.28) : 1;
            ctx.fillText(graphNode.name, graphNode.x, graphNode.y + radius + 2);
            ctx.globalAlpha = 1;
          }
        }}
        linkCurvature={(link) => (link as GraphLink).curvature ?? 0}
        linkCanvasObjectMode={() => 'after'}
        linkCanvasObject={(link, ctx, globalScale) => {
          if (lodStage !== 'micro') {
            return;
          }

          const graphLink = link as GraphLink;
          const source = link.source as { x?: number; y?: number } | string;
          const target = link.target as { x?: number; y?: number } | string;
          if (
            typeof source === 'string' ||
            typeof target === 'string' ||
            source.x === undefined ||
            source.y === undefined ||
            target.x === undefined ||
            target.y === undefined
          ) {
            return;
          }

          const safeScale = Number.isFinite(globalScale) && globalScale > 0 ? globalScale : 1;
          if (safeScale < 1.2) {
            return;
          }

          const label = graphLink.type;
          if (!label) {
            return;
          }

          const fontSize = LINK_LABEL_SCREEN_FONT_SIZE / safeScale;
          const textX = (source.x + target.x) / 2;
          const textY = (source.y + target.y) / 2;

          ctx.save();
          ctx.font = `${fontSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const textWidth = ctx.measureText(label).width;
          const paddingX = 2;
          const paddingY = 1;
          ctx.fillStyle = 'rgba(2, 6, 23, 0.6)';
          ctx.fillRect(
            textX - textWidth / 2 - paddingX,
            textY - fontSize / 2 - paddingY,
            textWidth + paddingX * 2,
            fontSize + paddingY * 2,
          );
          ctx.fillStyle = 'rgba(191, 219, 254, 0.9)';
          ctx.fillText(label, textX, textY);
          ctx.restore();
        }}
        linkVisibility={(link) => {
          const graphLink = link as GraphLink;
          return visibleLinkIds.has(`${graphLink.source}|${graphLink.type}|${graphLink.target}`);
        }}
        linkColor={(link) => {
          const graphLink = link as GraphLink;
          const linkId = `${graphLink.source}|${graphLink.type}|${graphLink.target}`;
          const isConnected = focusConnectedLinkIds.has(linkId);
          const edgeStyle = getEdgeStyleAtLod(graphLink.type, lodStage);
          const alpha = focusedNodeId ? (isConnected ? 1 : 0.012) : edgeStyle.alpha;
          return `rgba(148, 163, 184, ${alpha})`;
        }}
        linkWidth={(link) => {
          const graphLink = link as GraphLink;
          const linkId = `${graphLink.source}|${graphLink.type}|${graphLink.target}`;
          const isConnected = focusConnectedLinkIds.has(linkId);
          if (focusedNodeId) {
            return isConnected ? 1.9 : 0.35;
          }
          return getEdgeStyleAtLod(graphLink.type, lodStage).width;
        }}
      />

      {(hoveredLink || hoveredNodeId || focusedNodeId) && (
        <div className="pointer-events-none absolute bottom-[8.5rem] left-2 right-2 z-20 max-h-48 overflow-y-auto rounded-xl border border-slate-700/80 bg-slate-900/90 p-3 text-xs shadow-xl backdrop-blur sm:bottom-24 sm:left-4 sm:right-auto sm:max-h-64 sm:w-[min(380px,calc(100vw-2rem))]">
          {hoveredLink ? (
            <div>
              <p className="mb-1 font-semibold text-slate-100">Relationship</p>
              <p className="text-sky-300">{hoveredLink.type}</p>
              {(() => {
                const sourceName = nodeNameById.get(String(hoveredLink.source)) ?? String(hoveredLink.source);
                const targetName = nodeNameById.get(String(hoveredLink.target)) ?? String(hoveredLink.target);
                const chapterContext = [sourceName, targetName].find((name) =>
                  name.toLowerCase().includes('chapter'),
                );
                return chapterContext ? (
                  <p className="mt-1 text-slate-300">Chapter: {chapterContext}</p>
                ) : null;
              })()}
              {hoveredLink.description && (
                <p className="mt-1 text-slate-300">{hoveredLink.description}</p>
              )}
            </div>
          ) : hoveredNodeId ? (
            <div>
              <p className="mb-1 font-semibold text-slate-100">Entity</p>
              <p className="text-sky-300">{nodeNameById.get(hoveredNodeId) ?? hoveredNodeId}</p>
              <p className="mt-1 text-slate-300">
                Type: {nodeLabelById.get(hoveredNodeId) ?? 'Unknown'}
              </p>
              <p className="text-slate-400">Connections: {degreeMap.get(hoveredNodeId) ?? 0}</p>
            </div>
          ) : (
            <div>
              <p className="mb-2 font-semibold text-slate-100">Focused Relationships</p>
              <ul className="space-y-1.5 text-slate-300">
                {focusedRelationshipDetails.map((item) => (
                  <li key={`${item.sourceName}-${item.type}-${item.targetName}`}>
                    <span className="text-slate-100">{item.sourceName}</span>
                    <span className="mx-1 text-sky-300">[{item.type}]</span>
                    <span className="text-slate-100">{item.targetName}</span>
                    {item.chapterContext && (
                      <p className="ml-1 mt-0.5 text-[11px] text-slate-500">
                        Chapter: {item.chapterContext}
                      </p>
                    )}
                    {item.description && (
                      <p className="ml-1 mt-0.5 text-[11px] text-slate-400">{item.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <aside
        className={`pointer-events-auto absolute bottom-[4.75rem] left-2 right-2 z-20 flex w-auto ${chatWidthClass} flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/90 shadow-2xl backdrop-blur sm:bottom-24 sm:left-auto sm:right-4 ${
          isChatMinimized ? 'h-[56px] sm:h-[60px]' : 'h-[46vh] sm:top-24 sm:h-auto'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-100">Story Graph Chat</p>
            {!isChatMinimized && (
              <p className="text-xs text-slate-400">
                Ask natural language questions about entities and relationships.
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {!isChatMinimized && (
              <button
                type="button"
                onClick={() => setIsChatCompact((value) => !value)}
                className="rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                title="Toggle compact chat width"
              >
                {isChatCompact ? 'Wide' : 'Compact'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsChatMinimized((value) => !value)}
              className="rounded-md border border-slate-600 p-1.5 text-slate-200 hover:bg-slate-800"
              title={isChatMinimized ? 'Expand chat' : 'Minimize chat'}
            >
              {isChatMinimized ? (
                <Maximize2 className="h-3.5 w-3.5" />
              ) : (
                <Minimize2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        {!isChatMinimized && (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    message.role === 'user'
                      ? 'ml-10 bg-sky-500/15 text-sky-100'
                      : 'mr-10 bg-slate-800 text-slate-100'
                  }`}
                >
                  {message.role === 'assistant'
                    ? renderAssistantMessage(message.content)
                    : message.content}
                </div>
              ))}

              {isChatLoading && (
                <div className="mr-10 flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300">
                  <LoaderCircle className="h-4 w-4 animate-spin text-sky-400" />
                  Thinking...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form
              onSubmit={handleChatSubmit}
              className="flex items-center gap-2 border-t border-slate-700/70 p-3"
            >
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Ask about characters, locations, or arcs..."
                className="h-10 flex-1 rounded-md border border-slate-600 bg-slate-950 px-3 text-sm text-slate-100 outline-none ring-sky-400/50 placeholder:text-slate-500 focus:ring"
              />
              <button
                type="submit"
                disabled={isChatLoading || chatInput.trim().length === 0}
                className="flex h-10 w-10 items-center justify-center rounded-md bg-sky-500 text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </>
        )}
      </aside>

      <div className="pointer-events-auto absolute bottom-2 left-2 right-2 z-20 rounded-xl border border-slate-700/80 bg-slate-900/90 px-3 py-2.5 shadow-xl backdrop-blur sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-[min(760px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:px-4 sm:py-3">
        <div className="mb-2 mt-3 flex items-center justify-between text-xs text-slate-300">
          <span className="font-medium">Graph Padding</span>
          <span>{graphPadding.toFixed(1)}x</span>
        </div>
        <input
          type="range"
          min={1}
          max={4}
          step={0.1}
          value={graphPadding}
          onChange={(event) => setGraphPadding(Number(event.target.value))}
          className="w-full accent-amber-400"
        />
      </div>
    </main>
  );
}
