import { type Driver, type Session } from 'neo4j-driver';
import { createNeo4jDriver, createNeo4jSession } from '@/lib/neo4j';

export const runtime = 'nodejs';

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

type Neo4jNode = {
  elementId?: string;
  identity?: { toString: () => string };
  labels?: string[];
  properties?: Record<string, unknown>;
};

type Neo4jRelationship = {
  type?: string;
};

type Neo4jIntegerLike = {
  toNumber: () => number;
};

const isNeo4jInteger = (value: unknown): value is Neo4jIntegerLike => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toNumber' in value &&
    typeof (value as Neo4jIntegerLike).toNumber === 'function'
  );
};

const getNodeId = (node: Neo4jNode): string => {
  return node.elementId ?? node.identity?.toString() ?? '';
};

const getNodeName = (node: Neo4jNode): string => {
  const props = node.properties ?? {};
  const fallbackLabel = node.labels?.[0] ?? 'Node';
  return String(props.name ?? props.title ?? props.id ?? fallbackLabel);
};

const toFiniteNumber = (value: unknown): number | null => {
  if (isNeo4jInteger(value)) {
    const numberValue = value.toNumber();
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const extractChapter = (node: Neo4jNode): number | null => {
  const props = node.properties ?? {};
  const candidates: unknown[] = [
    props.chapter,
    props.firstChapter,
    props.chapterNumber,
    props.debutChapter,
    props.chapter_start,
  ];

  for (const candidate of candidates) {
    const chapter = toFiniteNumber(candidate);
    if (chapter !== null) {
      return chapter;
    }
  }

  return null;
};

export async function GET() {
  let driver: Driver | null = null;
  let session: Session | null = null;

  try {
    driver = createNeo4jDriver();
    session = createNeo4jSession(driver);

    const result = await session.run(
      'MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 300',
    );

    const nodesMap = new Map<string, GraphNode>();
    const links: GraphLink[] = [];

    for (const record of result.records) {
      const n = record.get('n') as Neo4jNode;
      const m = record.get('m') as Neo4jNode;
      const r = record.get('r') as Neo4jRelationship;

      const sourceId = getNodeId(n);
      const targetId = getNodeId(m);

      if (sourceId && !nodesMap.has(sourceId)) {
        nodesMap.set(sourceId, {
          id: sourceId,
          name: getNodeName(n),
          label: n.labels?.[0] ?? 'Node',
          chapter: extractChapter(n),
        });
      }

      if (targetId && !nodesMap.has(targetId)) {
        nodesMap.set(targetId, {
          id: targetId,
          name: getNodeName(m),
          label: m.labels?.[0] ?? 'Node',
          chapter: extractChapter(m),
        });
      }

      if (sourceId && targetId) {
        links.push({
          source: sourceId,
          target: targetId,
          type: r.type ?? 'RELATED_TO',
        });
      }
    }

    return Response.json({
      nodes: Array.from(nodesMap.values()),
      links,
    });
  } catch (error) {
    console.error('Failed to fetch graph data:', error);
    return Response.json(
      { error: 'Failed to fetch graph data from Neo4j' },
      { status: 500 },
    );
  } finally {
    if (session) {
      await session.close();
    }
    if (driver) {
      await driver.close();
    }
  }
}
