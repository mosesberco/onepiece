'use client';

import dynamic from 'next/dynamic';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle, Maximize2, Minimize2, Network, Send } from 'lucide-react';
import type { ForceGraphMethods } from 'react-force-graph-2d';
import { askGraphQuestion } from '@/app/actions/chat';

type GraphNode = {
  id: string;
  name: string;
  label: string;
  chapter: number | null;
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
const GRAPH_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_FOCUS_ZOOM = 2.1;
const FAR_EDGE_TYPES = new Set(['MEMBER_OF', 'RELATED_TO']);
const MEDIUM_HIGHLIGHT_TYPES = new Set(['OPPOSES', 'ALLIED_WITH', 'DEFEATED']);
const PRIMARY_CHARACTER_NAMES = ['monkey d. luffy', 'roronoa zoro', 'nami', 'sanji', 'usopp'];
const EDGE_BASE_ALPHA = 0.05;
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const getLodStage = (zoomLevel: number): 'far' | 'medium' | 'close' => {
  if (zoomLevel < 0.5) return 'far';
  if (zoomLevel < 1.5) return 'medium';
  return 'close';
};

const isEdgeVisibleAtLod = (edgeType: string, lodStage: 'far' | 'medium' | 'close'): boolean => {
  const normalizedType = edgeType.toUpperCase();
  if (lodStage === 'close') {
    return true;
  }
  if (lodStage === 'medium') {
    return FAR_EDGE_TYPES.has(normalizedType) || MEDIUM_HIGHLIGHT_TYPES.has(normalizedType);
  }
  return FAR_EDGE_TYPES.has(normalizedType);
};

export default function VisualizerPage() {
  const graphRef = useRef<ForceGraphMethods<ForceNode, ForceLink> | undefined>(undefined);
  const [allData, setAllData] = useState<GraphData>({ nodes: [], links: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [chapterLimit, setChapterLimit] = useState(1);
  const [graphPadding, setGraphPadding] = useState(3.2);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isChatCompact, setIsChatCompact] = useState(false);
  const [isChatMinimized, setIsChatMinimized] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<GraphLink | null>(null);
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

  const loadGraph = useCallback(async () => {
    if (isFirstLoadRef.current) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const response = await fetch('/api/graph', { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as GraphData;
      setAllData(payload);
    } catch (fetchError) {
      const message =
        fetchError instanceof Error
          ? fetchError.message
          : 'Unknown error while fetching graph';
      setError(message);
    } finally {
      isFirstLoadRef.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadGraph();
    }, GRAPH_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [loadGraph]);

  const chapterValues = useMemo(
    () =>
      allData.nodes
        .map((node) => node.chapter)
        .filter((chapter): chapter is number => chapter !== null && Number.isFinite(chapter)),
    [allData.nodes],
  );

  const maxChapter = useMemo(
    () => (chapterValues.length > 0 ? Math.max(...chapterValues) : 1),
    [chapterValues],
  );

  useEffect(() => {
    setChapterLimit((previous) => {
      if (previous <= 1 && maxChapter > 1) {
        return maxChapter;
      }
      return Math.min(previous, maxChapter);
    });
  }, [maxChapter]);

  const filteredData = useMemo<GraphData>(() => {
    if (chapterLimit >= maxChapter) {
      return allData;
    }

    const visibleNodeIds = new Set(
      allData.nodes
        .filter((node) => node.chapter !== null && node.chapter <= chapterLimit)
        .map((node) => node.id),
    );

    return {
      nodes: allData.nodes.filter((node) => visibleNodeIds.has(node.id)),
      links: allData.links.filter(
        (link) => visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target),
      ),
    };
  }, [allData, chapterLimit, maxChapter]);

  const characterNodeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of allData.nodes) {
      if (node.label === 'Character') {
        map.set(node.name.toLowerCase(), node.id);
      }
    }
    return map;
  }, [allData.nodes]);

  const degreeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of filteredData.links) {
      map.set(link.source, (map.get(link.source) ?? 0) + 1);
      map.set(link.target, (map.get(link.target) ?? 0) + 1);
    }
    return map;
  }, [filteredData.links]);

  const topConnectedNodeIds = useMemo(() => {
    return new Set(
      Array.from(degreeMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([nodeId]) => nodeId),
    );
  }, [degreeMap]);

  const visualData = useMemo<GraphData>(() => {
    const pairBuckets = new Map<string, number[]>();
    const links = filteredData.links.map((link, index) => {
      const a = String(link.source);
      const b = String(link.target);
      const key = [a, b].sort().join('::');
      const bucket = pairBuckets.get(key) ?? [];
      bucket.push(index);
      pairBuckets.set(key, bucket);
      return {
        ...link,
        curvature: 0,
      };
    });

    for (const indexes of pairBuckets.values()) {
      if (indexes.length <= 1) {
        continue;
      }
      indexes.forEach((linkIndex, orderIndex) => {
        const centered = orderIndex - (indexes.length - 1) / 2;
        links[linkIndex].curvature = centered * 0.12;
      });
    }

    return { nodes: filteredData.nodes, links };
  }, [filteredData]);

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

  const nodeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of visualData.nodes) {
      map.set(node.id, node.name);
    }
    return map;
  }, [visualData.nodes]);

  const lodStage = useMemo(() => getLodStage(zoomLevel), [zoomLevel]);

  const visibleLinks = useMemo(() => {
    return visualData.links.filter((link) => isEdgeVisibleAtLod(link.type, lodStage));
  }, [lodStage, visualData.links]);

  const visibleLinkIds = useMemo(() => {
    return new Set(visibleLinks.map((link) => `${link.source}|${link.type}|${link.target}`));
  }, [visibleLinks]);

  const connectedNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const link of visibleLinks) {
      set.add(String(link.source));
      set.add(String(link.target));
    }
    return set;
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

    const chargeStrength = -320 * graphPadding;
    const baseDistance = 90 * graphPadding;
    const chapterDistance = 72 * graphPadding;

    const chargeForce = graph.d3Force('charge') as
      | { strength?: (value: number) => unknown }
      | undefined;
    chargeForce?.strength?.(chargeStrength);

    const linkForce = graph.d3Force('link') as
      | { distance?: (distanceFn: (link: ForceLink) => number) => unknown }
      | undefined;
    linkForce?.distance?.((link: ForceLink) => {
      const sourceId = String(
        typeof link.source === 'object' && link.source !== null
          ? (link.source as ForceNode).id
          : link.source,
      );
      const targetId = String(
        typeof link.target === 'object' && link.target !== null
          ? (link.target as ForceNode).id
          : link.target,
      );
      const sourceLabel = visualData.nodes.find((node) => node.id === sourceId)?.label;
      const targetLabel = visualData.nodes.find((node) => node.id === targetId)?.label;
      const involvesChapter = sourceLabel === 'Chapter' || targetLabel === 'Chapter';
      return involvesChapter ? chapterDistance : baseDistance;
    });

    graph.d3ReheatSimulation();
  }, [graphPadding, visualData]);

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
    if (primaryNodeIds.has(nodeId)) {
      return true;
    }
    return connectedNodeIds.has(nodeId);
  };

  const chatWidthClass = isChatMinimized
    ? 'w-[220px]'
    : isChatCompact
      ? 'w-[280px]'
      : 'w-[360px]';

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
        return {
          sourceName: nodeNameById.get(sourceId) ?? sourceId,
          targetName: nodeNameById.get(targetId) ?? targetId,
          type: link.type,
          description: link.description,
        };
      });
  }, [focusedNodeId, nodeNameById, visibleLinks]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 p-4 sm:p-6">
        <div className="pointer-events-auto rounded-xl border border-slate-700/60 bg-slate-900/80 px-4 py-3 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-sky-400" />
            <h1 className="text-sm font-semibold tracking-wide text-slate-100">
              One Piece Knowledge Graph
            </h1>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {filteredData.nodes.length} visible nodes | {filteredData.links.length} links
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Total: {allData.nodes.length} nodes</p>
          <p className="mt-1 text-[11px] text-slate-500">
            Scroll to zoom, drag nodes to adjust spacing
          </p>
        </div>

        <div className="pointer-events-auto rounded-xl border border-slate-700/60 bg-slate-900/80 px-4 py-3 shadow-xl backdrop-blur">
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
        nodeVisibility={(node) => isNodeVisibleForZoom(String((node as GraphNode).id))}
        nodeAutoColorBy={undefined}
        nodeColor={(node) =>
          labelColorMap.get((node as GraphNode).label) ?? FALLBACK_NODE_COLOR
        }
        nodeCanvasObject={(node, ctx, globalScale) => {
          const graphNode = node as GraphNode & { x: number; y: number };
          const color = labelColorMap.get(graphNode.label) ?? FALLBACK_NODE_COLOR;
          const isHighlighted = highlightedNodeId === graphNode.id;
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
          const showOnlyPrimaryAtFarZoom = lodStage === 'far' && !primaryNodeIds.has(graphNode.id);
          const shouldShowLabel =
            !showOnlyPrimaryAtFarZoom &&
            (isHighlighted ||
              isTopConnected ||
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
        linkVisibility={(link) => {
          const graphLink = link as GraphLink;
          return visibleLinkIds.has(`${graphLink.source}|${graphLink.type}|${graphLink.target}`);
        }}
        linkColor={(link) => {
          const graphLink = link as GraphLink;
          const linkId = `${graphLink.source}|${graphLink.type}|${graphLink.target}`;
          const isConnected = focusConnectedLinkIds.has(linkId);
          const alpha = focusedNodeId ? (isConnected ? 1 : 0.012) : EDGE_BASE_ALPHA;
          return `rgba(148, 163, 184, ${alpha})`;
        }}
        linkWidth={(link) => {
          const graphLink = link as GraphLink;
          const linkId = `${graphLink.source}|${graphLink.type}|${graphLink.target}`;
          const isConnected = focusConnectedLinkIds.has(linkId);
          if (focusedNodeId) {
            return isConnected ? 1.9 : 0.35;
          }
          if (lodStage === 'medium' && MEDIUM_HIGHLIGHT_TYPES.has(graphLink.type.toUpperCase())) {
            return 1.05;
          }
          return 0.45;
        }}
      />

      {(hoveredLink || focusedNodeId) && (
        <div className="pointer-events-none absolute bottom-24 left-4 z-20 max-h-64 w-[min(380px,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-slate-700/80 bg-slate-900/90 p-3 text-xs shadow-xl backdrop-blur">
          {hoveredLink ? (
            <div>
              <p className="mb-1 font-semibold text-slate-100">Relationship</p>
              <p className="text-sky-300">{hoveredLink.type}</p>
              {hoveredLink.description && (
                <p className="mt-1 text-slate-300">{hoveredLink.description}</p>
              )}
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
        className={`pointer-events-auto absolute bottom-24 right-4 z-20 flex ${chatWidthClass} flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/90 shadow-2xl backdrop-blur ${
          isChatMinimized ? 'h-[60px]' : 'top-24'
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

      <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-slate-700/80 bg-slate-900/90 px-4 py-3 shadow-xl backdrop-blur">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
          <span className="font-medium">Chapter Filter</span>
          <span>
            1 - {chapterLimit} / {maxChapter}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={Math.max(1, maxChapter)}
          value={Math.max(1, chapterLimit)}
          onChange={(event) => setChapterLimit(Number(event.target.value))}
          className="w-full accent-sky-400"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Filters the graph by chapter debut (only entities up to the selected chapter remain visible).
        </p>
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
