import { type Driver, type Session } from 'neo4j-driver';
import { createNeo4jDriver, createNeo4jSession } from '@/lib/neo4j';

export const runtime = 'nodejs';

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
};

type Neo4jNode = {
  elementId?: string;
  identity?: { toString: () => string };
  labels?: string[];
  properties?: Record<string, unknown>;
};

type Neo4jRelationship = {
  type?: string;
  properties?: Record<string, unknown>;
};

const getNodeId = (node: Neo4jNode): string => {
  return node.elementId ?? node.identity?.toString() ?? '';
};

const getNodeName = (node: Neo4jNode): string => {
  const props = node.properties ?? {};
  const fallbackLabel = node.labels?.[0] ?? 'Node';
  return String(props.name ?? props.title ?? props.id ?? fallbackLabel);
};

const getRelationshipDescription = (relationship: Neo4jRelationship): string | undefined => {
  const description = relationship.properties?.description;
  if (typeof description !== 'string') {
    return undefined;
  }
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export async function GET() {
  let driver: Driver | null = null;
  let session: Session | null = null;

  try {
    driver = createNeo4jDriver();
    session = createNeo4jSession(driver);

    const result = await session.run(
      'MATCH (n)-[r]->(m) RETURN n, r, m ',
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
        });
      }

      if (targetId && !nodesMap.has(targetId)) {
        nodesMap.set(targetId, {
          id: targetId,
          name: getNodeName(m),
          label: m.labels?.[0] ?? 'Node',
        });
      }

      if (sourceId && targetId) {
        links.push({
          source: sourceId,
          target: targetId,
          type: r.type ?? 'RELATED_TO',
          description: getRelationshipDescription(r),
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
