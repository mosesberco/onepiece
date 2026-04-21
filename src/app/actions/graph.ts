'use server';

import neo4j from 'neo4j-driver';

export type GraphNode = {
  id: string;
  label: string;
  group: string;
  properties: Record<string, unknown>;
};

export type GraphLink = {
  source: string;
  target: string;
  type: string;
};

export type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

const driver = neo4j.driver(
  process.env.NEO4J_URI ?? 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER ?? 'neo4j',
    process.env.NEO4J_PASSWORD ?? 'neo4j',
  ),
);

export async function fetchGraph(): Promise<GraphData> {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (n)
      OPTIONAL MATCH (n)-[r]->(m)
      RETURN n, r, m
    `);

    const nodeMap = new Map<string, GraphNode>();
    const links: GraphLink[] = [];

    for (const record of result.records) {
      const n = record.get('n');
      const r = record.get('r');
      const m = record.get('m');

      const addNode = (node: any) => {
        if (!node) return;
        const id = node.elementId ?? node.identity.toString();
        if (nodeMap.has(id)) return;
        const label = node.labels?.[0] ?? 'Node';
        nodeMap.set(id, {
          id,
          label: (node.properties.name ?? node.properties.title ?? label) as string,
          group: label,
          properties: node.properties,
        });
      };

      addNode(n);
      addNode(m);

      if (r && m) {
        links.push({
          source: n.elementId ?? n.identity.toString(),
          target: m.elementId ?? m.identity.toString(),
          type: r.type,
        });
      }
    }

    return { nodes: Array.from(nodeMap.values()), links };
  } finally {
    await session.close();
  }
}
