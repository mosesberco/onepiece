'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { forceCollide } from 'd3-force';
import type { ForceGraphMethods } from 'react-force-graph-2d';
import type {
  ForceLink,
  ForceNode,
  GraphData,
  GraphLink,
  GraphNode,
  ViewMode,
} from '../types';
import { NODE_TYPE_COLORS, FALLBACK_NODE_COLOR, extractId } from '../types';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

type Props = {
  data: GraphData;
  width: number;
  height: number;
  mode: ViewMode;
  activeNodeId: string | null;
  hoveredNodeId: string | null;
  onNodeHover: (id: string | null) => void;
  onLinkHover: (link: GraphLink | null) => void;
  onNodeClick: (id: string) => void;
  onBackgroundClick: () => void;
  degreeMap: Map<string, number>;
};

const MIN_LABEL_SCALE = 1.1;
const MIN_NODE_RADIUS = 4;
const MAX_NODE_RADIUS = 18;
const NODE_LABEL_SCREEN_FONT_SIZE = 10;
const HIGHLIGHT_LABEL_FONT_SIZE = 12;

const PRIMARY_CHARACTER_NAMES = [
  'monkey d. luffy',
  'roronoa zoro',
  'nami',
  'sanji',
  'usopp',
];

const isHighStrengthLink = (strength: number | undefined): boolean => {
  if (typeof strength !== 'number' || !Number.isFinite(strength)) return false;
  return strength > 1 ? strength >= 7 : strength >= 0.7;
};

export function GraphCanvas({
  data,
  width,
  height,
  mode,
  activeNodeId,
  hoveredNodeId,
  onNodeHover,
  onLinkHover,
  onNodeClick,
  onBackgroundClick,
  degreeMap,
}: Props) {
  const graphRef = useRef<ForceGraphMethods<ForceNode, ForceLink> | undefined>(undefined);
  const viewportCenterRef = useRef<{ x: number; y: number } | null>(null);
  const latestZoomRef = useRef(1);
  const hasInitialFocusRef = useRef(false);

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of data.nodes) m.set(n.id, n);
    return m;
  }, [data.nodes]);

  const primaryNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of data.nodes) {
      const name = node.name.toLowerCase();
      if (PRIMARY_CHARACTER_NAMES.some((p) => name.includes(p))) ids.add(node.id);
    }
    return ids;
  }, [data.nodes]);

  const focusConnectedSet = useMemo(() => {
    const target = hoveredNodeId ?? activeNodeId;
    if (!target) return new Set<string>();
    const set = new Set<string>([target]);
    for (const link of data.links) {
      const s = extractId(link.source);
      const t = extractId(link.target);
      if (s === target || t === target) {
        set.add(s);
        set.add(t);
      }
    }
    return set;
  }, [activeNodeId, data.links, hoveredNodeId]);

  const focusConnectedLinkIds = useMemo(() => {
    const target = hoveredNodeId ?? activeNodeId;
    if (!target) return new Set<string>();
    const set = new Set<string>();
    for (const link of data.links) {
      const s = extractId(link.source);
      const t = extractId(link.target);
      if (s === target || t === target) {
        set.add(`${s}|${link.type}|${t}`);
      }
    }
    return set;
  }, [activeNodeId, data.links, hoveredNodeId]);

  const focusedNodeId = hoveredNodeId ?? activeNodeId;

  const computeNodeRadius = useCallback(
    (node: GraphNode, globalScale: number): number => {
      const deg = degreeMap.get(node.id) ?? 0;
      const structural = Math.max(1, node.val ?? deg);
      const safeScale =
        Number.isFinite(globalScale) && globalScale > 0 ? globalScale : 1;
      const valBoost = Math.min(10, Math.sqrt(structural) * 1.4);
      const degBoost = Math.min(8, Math.log2(deg + 1) * 2.4);
      let base = 5 + valBoost + degBoost;
      if (node.group === 'Chapter') base *= 0.7;
      if (primaryNodeIds.has(node.id)) base += 1;
      if (activeNodeId === node.id) base += 3;
      return Math.min(
        MAX_NODE_RADIUS,
        Math.max(MIN_NODE_RADIUS, base / Math.sqrt(safeScale)),
      );
    },
    [activeNodeId, degreeMap, primaryNodeIds],
  );

  const getSpotlightAlpha = useCallback(
    (x: number, y: number, scale: number): number => {
      if (focusedNodeId) return 1;
      if (mode === 'explorer') return 1;
      const c = viewportCenterRef.current;
      if (!c || scale <= 0) return 1;
      const dx = (x - c.x) * scale;
      const dy = (y - c.y) * scale;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDim = Math.min(width, height);
      if (minDim <= 0) return 1;
      const rFull = minDim * 0.3;
      const rZero = minDim * 0.72;
      const floor = 0.4;
      if (dist <= rFull) return 1;
      if (dist >= rZero) return floor;
      const t = (dist - rFull) / (rZero - rFull);
      return 1 - t * (1 - floor);
    },
    [focusedNodeId, height, mode, width],
  );

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || data.links.length === 0) return;

    const chargeForce = graph.d3Force('charge') as
      | { strength?: (v: number) => unknown }
      | undefined;
    chargeForce?.strength?.(mode === 'explorer' ? -800 : -520);

    const linkForce = graph.d3Force('link') as
      | {
          distance?: (fn: (link: ForceLink) => number) => unknown;
          strength?: (fn: (link: ForceLink) => number) => unknown;
        }
      | undefined;
    linkForce?.distance?.((link: ForceLink) => {
      const base = (link as GraphLink).distance ?? 110;
      return mode === 'explorer' ? base * 1.8 : base * 2.2;
    });
    linkForce?.strength?.((link: ForceLink) => {
      const provided = (link as GraphLink).strength;
      if (typeof provided === 'number' && Number.isFinite(provided)) {
        const norm = provided > 1 ? provided / 30 : provided;
        return Math.min(0.3, Math.max(0.03, norm));
      }
      const t = String((link as GraphLink).type ?? '').toUpperCase();
      if (t === 'MEMBER_OF' || t === 'RELATED_TO') return 0.22;
      if (t === 'ATTACKED' || t === 'APPEARED_IN') return 0.03;
      return 0.08;
    });

    graph.d3Force(
      'collide',
      forceCollide<ForceNode>().radius((node: ForceNode) => {
        const id = String(node.id ?? '');
        const deg = degreeMap.get(id) ?? 0;
        const group = nodeById.get(id)?.group;
        let r = 6 + Math.min(9, Math.log2(deg + 1) * 2.2);
        if (group === 'Chapter') r *= 0.7;
        return r + 3;
      }),
    );

    graph.d3ReheatSimulation();
  }, [data.links, degreeMap, mode, nodeById]);

  useEffect(() => {
    if (!activeNodeId) return;
    const graph = graphRef.current;
    if (!graph) return;
    const timer = window.setTimeout(() => {
      const node = nodeById.get(activeNodeId) as
        | (GraphNode & { x?: number; y?: number })
        | undefined;
      if (!node || node.x === undefined || node.y === undefined) return;
      graph.centerAt(node.x, node.y, 800);
      graph.zoom(mode === 'explorer' ? 2.4 : 2.0, 800);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeNodeId, mode, nodeById]);

  useEffect(() => {
    if (mode !== 'freeform') return;
    const graph = graphRef.current;
    if (!graph) return;
    const timer = window.setTimeout(() => {
      graph.zoomToFit(700, 40);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [mode]);

  useEffect(() => {
    hasInitialFocusRef.current = false;
  }, [mode]);

  return (
    <ForceGraph2D
      ref={graphRef}
      width={width}
      height={height}
      graphData={data}
      backgroundColor="#05070c"
      cooldownTicks={mode === 'explorer' ? 140 : 300}
      d3AlphaDecay={0.025}
      d3VelocityDecay={0.2}
      onEngineStop={() => {
        if (hasInitialFocusRef.current) return;
        hasInitialFocusRef.current = true;
        const graph = graphRef.current;
        if (!graph) return;
        if (activeNodeId) {
          const node = nodeById.get(activeNodeId) as
            | (GraphNode & { x?: number; y?: number })
            | undefined;
          if (node?.x !== undefined && node?.y !== undefined) {
            graph.centerAt(node.x, node.y, 600);
            graph.zoom(2.2, 600);
            return;
          }
        }
        graph.zoomToFit(600, 60);
      }}
      onZoom={(transform) => {
        latestZoomRef.current = transform.k;
        const t = transform as { k: number; x?: number; y?: number };
        if (
          typeof t.x === 'number' &&
          typeof t.y === 'number' &&
          t.k > 0 &&
          width > 0 &&
          height > 0
        ) {
          viewportCenterRef.current = {
            x: (width / 2 - t.x) / t.k,
            y: (height / 2 - t.y) / t.k,
          };
        }
      }}
      onBackgroundClick={onBackgroundClick}
      onNodeClick={(node) => onNodeClick(String((node as GraphNode).id))}
      onNodeHover={(node) => onNodeHover(node ? String((node as GraphNode).id) : null)}
      onLinkHover={(link) => onLinkHover(link ? (link as GraphLink) : null)}
      nodeLabel={(node) => `${(node as GraphNode).name} (${(node as GraphNode).group})`}
      nodeCanvasObject={(node, ctx, globalScale) => {
        const n = node as GraphNode & { x: number; y: number };
        const color = NODE_TYPE_COLORS[n.group] ?? FALLBACK_NODE_COLOR;
        const isActive = activeNodeId === n.id;
        const isHovered = hoveredNodeId === n.id;
        const isPrimary = primaryNodeIds.has(n.id);
        const isInFocus =
          !focusedNodeId || focusConnectedSet.has(n.id) || isPrimary;
        const safeScale = Number.isFinite(globalScale) && globalScale > 0 ? globalScale : 1;
        const radius = computeNodeRadius(n, safeScale);

        const spotlight = getSpotlightAlpha(n.x, n.y, safeScale);
        const nodeAlpha = focusedNodeId ? (isInFocus ? 1 : 0.18) : spotlight;

        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);
        ctx.fillStyle = color;
        ctx.globalAlpha = nodeAlpha;
        ctx.fill();
        ctx.globalAlpha = 1;

        if (isActive) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius + 3.5, 0, 2 * Math.PI, false);
          ctx.strokeStyle = 'rgba(125, 211, 252, 0.95)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius + 6, 0, 2 * Math.PI, false);
          ctx.strokeStyle = 'rgba(125, 211, 252, 0.25)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        } else if (isPrimary && !focusedNodeId) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius + 2, 0, 2 * Math.PI, false);
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        const shouldShowLabel =
          isActive ||
          isHovered ||
          (mode === 'explorer' && globalScale >= MIN_LABEL_SCALE) ||
          (focusedNodeId &&
            focusConnectedSet.has(n.id) &&
            globalScale >= MIN_LABEL_SCALE) ||
          (!focusedNodeId && isPrimary && globalScale >= MIN_LABEL_SCALE) ||
          (mode === 'constellation' && globalScale >= 0.9);

        if (shouldShowLabel) {
          const screenFont = isActive
            ? HIGHLIGHT_LABEL_FONT_SIZE
            : n.group === 'Chapter'
              ? NODE_LABEL_SCREEN_FONT_SIZE - 2
              : NODE_LABEL_SCREEN_FONT_SIZE;
          const fontSize = screenFont / safeScale;
          ctx.font = `${isActive ? '600 ' : ''}${fontSize}px ui-sans-serif, system-ui`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const labelY = n.y + radius + 3;
          const textWidth = ctx.measureText(n.name).width;
          ctx.fillStyle = 'rgba(5, 7, 12, 0.75)';
          ctx.fillRect(
            n.x - textWidth / 2 - 3,
            labelY - 1,
            textWidth + 6,
            fontSize + 3,
          );
          ctx.fillStyle = isActive ? '#e0f2fe' : '#cbd5e1';
          ctx.globalAlpha = focusedNodeId ? (isInFocus ? 1 : 0.3) : spotlight;
          ctx.fillText(n.name, n.x, labelY);
          ctx.globalAlpha = 1;
        }
      }}
      nodePointerAreaPaint={(node, color, ctx, globalScale) => {
        const n = node as GraphNode & { x?: number; y?: number };
        if (n.x === undefined || n.y === undefined) return;
        const safeScale =
          Number.isFinite(globalScale) && globalScale > 0 ? globalScale : 1;
        const radius = computeNodeRadius(n, safeScale);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 2, 0, 2 * Math.PI, false);
        ctx.fill();
      }}
      linkCurvature={(link) => (link as GraphLink).curvature ?? 0.15}
      linkColor={(link) => {
        const gl = link as GraphLink;
        const linkId = `${extractId(gl.source)}|${gl.type}|${extractId(gl.target)}`;
        const isConnected = focusConnectedLinkIds.has(linkId);
        let alpha = focusedNodeId ? (isConnected ? 0.75 : 0.03) : 0.3;
        if (mode === 'explorer') alpha = isConnected ? 0.7 : 0.35;
        if (!focusedNodeId && mode !== 'explorer') {
          const src = link.source as { x?: number; y?: number } | string;
          const tgt = link.target as { x?: number; y?: number } | string;
          if (
            typeof src !== 'string' &&
            typeof tgt !== 'string' &&
            src.x !== undefined &&
            src.y !== undefined &&
            tgt.x !== undefined &&
            tgt.y !== undefined
          ) {
            alpha *= getSpotlightAlpha(
              (src.x + tgt.x) / 2,
              (src.y + tgt.y) / 2,
              latestZoomRef.current,
            );
          }
        }
        return `rgba(148, 163, 184, ${alpha})`;
      }}
      linkWidth={(link) => {
        const gl = link as GraphLink;
        const linkId = `${extractId(gl.source)}|${gl.type}|${extractId(gl.target)}`;
        if (focusConnectedLinkIds.has(linkId)) return 2;
        return mode === 'explorer' ? 1.1 : 0.8;
      }}
      linkDirectionalArrowLength={(link) => {
        const gl = link as GraphLink;
        const linkId = `${extractId(gl.source)}|${gl.type}|${extractId(gl.target)}`;
        if (focusedNodeId) return focusConnectedLinkIds.has(linkId) ? 5.5 : 0;
        return mode === 'explorer' ? 4 : 3;
      }}
      linkDirectionalArrowRelPos={0.94}
      linkDirectionalArrowColor={(link) => {
        const gl = link as GraphLink;
        const linkId = `${extractId(gl.source)}|${gl.type}|${extractId(gl.target)}`;
        const isConnected = focusConnectedLinkIds.has(linkId);
        const alpha = focusedNodeId ? (isConnected ? 0.9 : 0.04) : 0.5;
        return `rgba(186, 230, 253, ${alpha})`;
      }}
      linkCanvasObjectMode={() => 'after'}
      linkCanvasObject={(link, ctx, globalScale) => {
        const gl = link as GraphLink;
        const linkId = `${extractId(gl.source)}|${gl.type}|${extractId(gl.target)}`;
        const src = link.source as { x?: number; y?: number } | string;
        const tgt = link.target as { x?: number; y?: number } | string;
        if (
          typeof src === 'string' ||
          typeof tgt === 'string' ||
          src.x === undefined ||
          src.y === undefined ||
          tgt.x === undefined ||
          tgt.y === undefined
        )
          return;

        const showLabel = focusConnectedLinkIds.has(linkId) || globalScale >= 3.2;
        if (!showLabel) return;

        const safeScale =
          Number.isFinite(globalScale) && globalScale > 0 ? globalScale : 1;
        const fontSize = 8 / safeScale;
        const midX = (src.x + tgt.x) / 2;
        const midY = (src.y + tgt.y) / 2;
        ctx.save();
        ctx.font = `${fontSize}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const textWidth = ctx.measureText(gl.type).width;
        ctx.fillStyle = 'rgba(5, 7, 12, 0.75)';
        ctx.fillRect(
          midX - textWidth / 2 - 2,
          midY - fontSize / 2 - 1,
          textWidth + 4,
          fontSize + 2,
        );
        ctx.fillStyle = 'rgba(191, 219, 254, 0.95)';
        ctx.fillText(gl.type, midX, midY);
        ctx.restore();
      }}
      linkDirectionalParticles={(link) => {
        const gl = link as GraphLink;
        if (!isHighStrengthLink(gl.strength)) return 0;
        if (focusedNodeId) {
          const linkId = `${extractId(gl.source)}|${gl.type}|${extractId(gl.target)}`;
          return focusConnectedLinkIds.has(linkId) ? 4 : 0;
        }
        return mode === 'explorer' ? 2 : 1;
      }}
      linkDirectionalParticleWidth={(link) =>
        isHighStrengthLink((link as GraphLink).strength) ? 2 : 0
      }
      linkDirectionalParticleSpeed={(link) => {
        const gl = link as GraphLink;
        if (!isHighStrengthLink(gl.strength)) return 0;
        const raw = gl.strength;
        const norm =
          typeof raw === 'number' ? (raw > 1 ? raw / 10 : raw) : 1;
        return 0.003 + Math.min(0.015, norm * 0.01);
      }}
      linkDirectionalParticleColor={() => 'rgba(34,211,238,0.9)'}
    />
  );
}
