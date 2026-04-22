export type Neo4jGraphRow = {
  sId: unknown;
  sName: unknown;
  sType: unknown;
  sSize: unknown;
  rType: unknown;
  rDesc: unknown;
  rStrength: unknown;
  tId: unknown;
  tName: unknown;
  tType: unknown;
  tSize: unknown;
};

export type ForceGraphNode = {
  id: string;
  name: string;
  group: string;
  val: number;
  label: string;
};

export type ForceGraphLink = {
  source: string;
  target: string;
  type: string;
  description?: string;
  curvature: number;
  distance: number;
  strength?: number;
};

export type ForceGraphData = {
  nodes: ForceGraphNode[];
  links: ForceGraphLink[];
};

const LINK_DISTANCE_BY_TYPE: Record<string, number> = {
  MEMBER_OF: 30,
  RELATED_TO: 45,
  ALLIED_WITH: 65,
  OPPOSES: 80,
  ATTACKED: 150,
  APPEARED_IN: 170,
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === 'object') {
    const maybeToNumber = (value as { toNumber?: () => number }).toNumber;
    if (typeof maybeToNumber === 'function') {
      const parsed = maybeToNumber.call(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const maybeToString = (value as { toString?: () => string }).toString;
    if (typeof maybeToString === 'function') {
      const parsed = Number(maybeToString.call(value));
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
};

const toNonEmptyString = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const getLinkDistance = (relationshipType: string): number => {
  const normalizedType = relationshipType.toUpperCase();
  return LINK_DISTANCE_BY_TYPE[normalizedType] ?? 100;
};

const getNodeId = (value: unknown): string | null => {
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return null;
  }
  return String(parsed);
};

const getNodeSizeValue = (value: unknown): number => {
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return 1;
  }
  return Math.max(1, parsed);
};

export const transformNeo4jRowsToForceGraph = (rows: Neo4jGraphRow[]): ForceGraphData => {
  const nodes = new Map<string, ForceGraphNode>();
  const links: ForceGraphLink[] = [];

  for (const row of rows) {
    const sourceId = getNodeId(row.sId);
    const targetId = getNodeId(row.tId);

    if (!sourceId || !targetId) {
      continue;
    }

    if (!nodes.has(sourceId)) {
      const sourceType = toNonEmptyString(row.sType, 'Entity');
      const sourceName = toNonEmptyString(row.sName, sourceType);
      nodes.set(sourceId, {
        id: sourceId,
        name: sourceName,
        group: sourceType,
        val: getNodeSizeValue(row.sSize),
        label: sourceType,
      });
    }

    if (!nodes.has(targetId)) {
      const targetType = toNonEmptyString(row.tType, 'Entity');
      const targetName = toNonEmptyString(row.tName, targetType);
      nodes.set(targetId, {
        id: targetId,
        name: targetName,
        group: targetType,
        val: getNodeSizeValue(row.tSize),
        label: targetType,
      });
    }

    const relationshipType = toNonEmptyString(row.rType, 'RELATED_TO');
    const relationshipDescription = toNonEmptyString(row.rDesc, '').trim();
    const relationshipStrength = toFiniteNumber(row.rStrength);

    links.push({
      source: sourceId,
      target: targetId,
      type: relationshipType,
      description: relationshipDescription.length > 0 ? relationshipDescription : undefined,
      curvature: 0.2,
      distance: getLinkDistance(relationshipType),
      strength: relationshipStrength ?? undefined,
    });
  }

  return {
    nodes: Array.from(nodes.values()),
    links,
  };
};
