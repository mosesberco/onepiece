export type GraphNode = {
  id: string;
  name: string;
  group: string;
  val: number;
  label?: string;
};

export type GraphLink = {
  source: string;
  target: string;
  type: string;
  description?: string;
  curvature?: number;
  distance?: number;
  strength?: number;
};

export type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export type ViewMode = 'constellation' | 'explorer' | 'freeform';

export type ForceNode = {
  id?: string | number;
  x?: number;
  y?: number;
  [key: string]: unknown;
};

export type ForceLink = {
  source?: string | number | ForceNode;
  target?: string | number | ForceNode;
  [key: string]: unknown;
};

export const NODE_TYPE_COLORS: Record<string, string> = {
  Character: '#38bdf8',
  Location: '#a78bfa',
  Organization: '#fb923c',
  Chapter: '#475569',
  Concept: '#f472b6',
  Artifact: '#facc15',
  Entity: '#22d3ee',
};

export const FALLBACK_NODE_COLOR = '#94a3b8';

export const extractId = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'id' in v) {
    return String((v as { id: unknown }).id);
  }
  return '';
};

export const VIEW_MODE_LABELS: Record<ViewMode, { title: string; hint: string }> = {
  constellation: { title: 'Constellation', hint: 'Only major hubs' },
  explorer: { title: 'Explorer', hint: 'Focused on one node' },
  freeform: { title: 'Freeform', hint: 'Everything visible' },
};
