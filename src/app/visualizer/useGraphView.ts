'use client';

import { useCallback, useMemo, useState } from 'react';
import type { GraphData, GraphNode, ViewMode } from './types';
import { extractId } from './types';

const CONSTELLATION_HUB_COUNT = 36;

export type GraphViewState = ReturnType<typeof useGraphView>;

export function useGraphView(allData: GraphData) {
  const [mode, setMode] = useState<ViewMode>('constellation');
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [disabledRelTypes, setDisabledRelTypes] = useState<Set<string>>(
    () => new Set(['APPEARED_IN']),
  );
  const [disabledNodeTypes, setDisabledNodeTypes] = useState<Set<string>>(new Set());

  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of allData.nodes) map.set(node.id, node);
    return map;
  }, [allData.nodes]);

  const degreeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of allData.links) {
      if (disabledRelTypes.has(link.type)) continue;
      const s = extractId(link.source);
      const t = extractId(link.target);
      map.set(s, (map.get(s) ?? 0) + 1);
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    return map;
  }, [allData.links, disabledRelTypes]);

  const relationshipTypes = useMemo(
    () => Array.from(new Set(allData.links.map((l) => l.type))).sort(),
    [allData.links],
  );

  const nodeTypes = useMemo(
    () => Array.from(new Set(allData.nodes.map((n) => n.group))).sort(),
    [allData.nodes],
  );

  const hubNodeIds = useMemo(() => {
    return new Set(
      Array.from(degreeMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, CONSTELLATION_HUB_COUNT)
        .map(([id]) => id),
    );
  }, [degreeMap]);

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of allData.links) {
      if (disabledRelTypes.has(link.type)) continue;
      const s = extractId(link.source);
      const t = extractId(link.target);
      if (!map.has(s)) map.set(s, new Set());
      if (!map.has(t)) map.set(t, new Set());
      map.get(s)!.add(t);
      map.get(t)!.add(s);
    }
    return map;
  }, [allData.links, disabledRelTypes]);

  const shellNodeIds = useMemo(() => {
    if (!activeNodeId) return new Set<string>();
    const set = new Set<string>([activeNodeId]);
    const neighbors = adjacency.get(activeNodeId);
    if (neighbors) for (const n of neighbors) set.add(n);
    return set;
  }, [activeNodeId, adjacency]);

  const visibleData = useMemo<GraphData>(() => {
    const passesNodeFilter = (node: GraphNode) => !disabledNodeTypes.has(node.group);
    const passesLinkFilter = (type: string) => !disabledRelTypes.has(type);

    const linkMatches = (
      nodeIdSet: Set<string>,
      l: { type: string; source: unknown; target: unknown },
    ) =>
      passesLinkFilter(l.type) &&
      nodeIdSet.has(extractId(l.source)) &&
      nodeIdSet.has(extractId(l.target));

    if (mode === 'explorer' && activeNodeId) {
      const nodes = allData.nodes.filter(
        (n) => shellNodeIds.has(n.id) && passesNodeFilter(n),
      );
      const nodeIdSet = new Set(nodes.map((n) => n.id));
      const links = allData.links.filter((l) => linkMatches(nodeIdSet, l));
      return { nodes, links };
    }

    if (mode === 'constellation') {
      const nodes = allData.nodes.filter(
        (n) => hubNodeIds.has(n.id) && passesNodeFilter(n),
      );
      const nodeIdSet = new Set(nodes.map((n) => n.id));
      const links = allData.links.filter((l) => linkMatches(nodeIdSet, l));
      return { nodes, links };
    }

    const nodes = allData.nodes.filter(passesNodeFilter);
    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const links = allData.links.filter((l) => linkMatches(nodeIdSet, l));
    return { nodes, links };
  }, [
    activeNodeId,
    allData.links,
    allData.nodes,
    disabledNodeTypes,
    disabledRelTypes,
    hubNodeIds,
    mode,
    shellNodeIds,
  ]);

  const activeNode = activeNodeId ? nodeById.get(activeNodeId) ?? null : null;

  const activeNodeLinks = useMemo(() => {
    if (!activeNodeId) return [];
    return allData.links.filter((l) => {
      if (disabledRelTypes.has(l.type)) return false;
      const s = extractId(l.source);
      const t = extractId(l.target);
      return s === activeNodeId || t === activeNodeId;
    });
  }, [activeNodeId, allData.links, disabledRelTypes]);

  const selectNode = useCallback(
    (id: string) => {
      setActiveNodeId(id);
      setHistory((prev) => (prev[prev.length - 1] === id ? prev : [...prev, id]));
      setMode((current) => (current === 'constellation' ? 'explorer' : current));
    },
    [],
  );

  const goBack = useCallback(() => {
    setHistory((prev) => {
      if (prev.length <= 1) {
        setActiveNodeId(null);
        return [];
      }
      const next = prev.slice(0, -1);
      setActiveNodeId(next[next.length - 1] ?? null);
      return next;
    });
  }, []);

  const jumpTo = useCallback((index: number) => {
    setHistory((prev) => {
      const next = prev.slice(0, index + 1);
      setActiveNodeId(next[next.length - 1] ?? null);
      return next;
    });
  }, []);

  const clearActive = useCallback(() => {
    setActiveNodeId(null);
    setHistory([]);
  }, []);

  const toggleRelType = useCallback((type: string) => {
    setDisabledRelTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const toggleNodeType = useCallback((type: string) => {
    setDisabledNodeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const setAllRelTypes = useCallback((disabled: boolean) => {
    setDisabledRelTypes(disabled ? new Set(relationshipTypes) : new Set());
  }, [relationshipTypes]);

  return {
    mode,
    setMode,
    activeNodeId,
    activeNode,
    activeNodeLinks,
    history,
    visibleData,
    nodeById,
    degreeMap,
    hubNodeIds,
    relationshipTypes,
    nodeTypes,
    disabledRelTypes,
    disabledNodeTypes,
    selectNode,
    goBack,
    jumpTo,
    clearActive,
    toggleRelType,
    toggleNodeType,
    setAllRelTypes,
  };
}
