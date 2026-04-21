'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { GraphData, GraphNode } from '@/app/actions/graph';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const PALETTE = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#22d3ee', '#facc15'];

export default function GraphView({ data }: { data: GraphData }) {
  const ref = useRef<any>(null);
  const [hover, setHover] = useState<GraphNode | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const groupColor = useMemo(() => {
    const groups = Array.from(new Set(data.nodes.map((n) => n.group)));
    return Object.fromEntries(groups.map((g, i) => [g, PALETTE[i % PALETTE.length]]));
  }, [data.nodes]);

  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <div className="relative h-screen w-screen bg-[#0b0d12] text-slate-200">
      <div className="absolute left-6 top-6 z-10 rounded-lg border border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
        <h1 className="text-sm font-semibold tracking-wide text-white">Graph Explorer</h1>
        <p className="text-xs text-slate-400">
          {data.nodes.length} nodes · {data.links.length} relationships
        </p>
      </div>

      <div className="absolute right-6 top-6 z-10 rounded-lg border border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
        <p className="mb-2 text-xs uppercase tracking-wider text-slate-400">Legend</p>
        <ul className="space-y-1">
          {Object.entries(groupColor).map(([group, color]) => (
            <li key={group} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
              {group}
            </li>
          ))}
        </ul>
      </div>

      {hover && (
        <div className="pointer-events-none absolute bottom-6 left-6 z-10 max-w-sm rounded-lg border border-white/10 bg-black/60 px-4 py-3 backdrop-blur">
          <p className="text-xs uppercase tracking-wider text-slate-400">{hover.group}</p>
          <p className="text-sm font-medium text-white">{hover.label}</p>
        </div>
      )}

      <ForceGraph2D
        ref={ref}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="#0b0d12"
        nodeLabel={(n: any) => `${n.group}: ${n.label}`}
        nodeRelSize={5}
        linkColor={() => 'rgba(148,163,184,0.25)'}
        linkWidth={1}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleColor={() => 'rgba(96,165,250,0.8)'}
        onNodeHover={(n: any) => setHover(n ?? null)}
        nodeCanvasObject={(node: any, ctx, globalScale) => {
          const color = groupColor[node.group] ?? '#60a5fa';
          ctx.beginPath();
          ctx.arc(node.x, node.y, 6, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;

          if (globalScale > 1.5) {
            ctx.font = `${12 / globalScale}px Inter, sans-serif`;
            ctx.fillStyle = 'rgba(226,232,240,0.9)';
            ctx.textAlign = 'center';
            ctx.fillText(node.label, node.x, node.y + 10);
          }
        }}
      />
    </div>
  );
}
