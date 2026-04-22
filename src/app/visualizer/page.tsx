'use client';

import dynamic from 'next/dynamic';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle, Network, Send } from 'lucide-react';
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

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
});

const LABEL_COLORS: Record<string, string> = {
  Character: '#facc15',
  Location: '#38bdf8',
  Organization: '#ef4444',
};

const FALLBACK_NODE_COLOR = '#94a3b8';
const MIN_LABEL_SCALE = 1.3;
const MIN_NODE_RADIUS = 2.5;
const MAX_NODE_RADIUS = 7;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 16;
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function VisualizerPage() {
  const [allData, setAllData] = useState<GraphData>({ nodes: [], links: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [chapterLimit, setChapterLimit] = useState(1);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: makeId(),
      role: 'assistant',
      content:
        'Ask anything about the story graph. Example: Who is Luffy role model? or Which locations appear early in the story?',
    },
  ]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const syncViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  useEffect(() => {
    const loadGraph = async () => {
      setIsLoading(true);
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
        setIsLoading(false);
      }
    };

    void loadGraph();
  }, []);

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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isChatLoading]);

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
    () => [
      { label: 'Character', color: LABEL_COLORS.Character },
      { label: 'Location', color: LABEL_COLORS.Location },
      { label: 'Organization', color: LABEL_COLORS.Organization },
    ],
    [],
  );

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
        width={viewport.width}
        height={viewport.height}
        graphData={filteredData}
        backgroundColor="#020617"
        cooldownTicks={220}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.28}
        nodeLabel={(node) => `${node.name} (${node.label})`}
        nodeAutoColorBy={undefined}
        nodeColor={(node) =>
          LABEL_COLORS[(node as GraphNode).label] ?? FALLBACK_NODE_COLOR
        }
        nodeCanvasObject={(node, ctx, globalScale) => {
          const graphNode = node as GraphNode & { x: number; y: number };
          const color = LABEL_COLORS[graphNode.label] ?? FALLBACK_NODE_COLOR;
          const isHighlighted = highlightedNodeId === graphNode.id;
          const safeScale = Number.isFinite(globalScale) && globalScale > 0 ? globalScale : 1;
          const baseRadius = isHighlighted ? 9 : 5;
          const radius = Math.min(
            MAX_NODE_RADIUS,
            Math.max(MIN_NODE_RADIUS, baseRadius / Math.sqrt(safeScale)),
          );

          ctx.beginPath();
          ctx.arc(graphNode.x, graphNode.y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = color;
          ctx.fill();

          if (isHighlighted) {
            ctx.beginPath();
            ctx.arc(graphNode.x, graphNode.y, radius + 2.5, 0, 2 * Math.PI, false);
            ctx.strokeStyle = 'rgba(186, 230, 253, 0.95)';
            ctx.lineWidth = 1.7;
            ctx.stroke();
          }

          if (globalScale >= MIN_LABEL_SCALE) {
            const rawFontSize = (isHighlighted ? 14 : 12) / Math.sqrt(safeScale);
            const fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, rawFontSize));
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = isHighlighted ? '#f8fafc' : '#e2e8f0';
            ctx.fillText(graphNode.name, graphNode.x, graphNode.y + radius + 2);
          }
        }}
        linkColor={() => 'rgba(148, 163, 184, 0.35)'}
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleColor={() => 'rgba(125, 211, 252, 0.85)'}
      />

      <aside className="pointer-events-auto absolute bottom-24 right-4 top-24 z-20 flex w-[360px] flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/90 shadow-2xl backdrop-blur">
        <div className="border-b border-slate-700/70 px-4 py-3">
          <p className="text-sm font-semibold text-slate-100">Story Graph Chat</p>
          <p className="text-xs text-slate-400">
            Ask natural language questions about entities and relationships.
          </p>
        </div>

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
      </div>
    </main>
  );
}
