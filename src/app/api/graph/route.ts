import { type Driver, type Session } from 'neo4j-driver';
import { createNeo4jDriver, createNeo4jSession } from '@/lib/neo4j';
import {
  type Neo4jGraphRow,
  transformNeo4jRowsToForceGraph,
} from '@/lib/graph-transform';

export const runtime = 'nodejs';

export async function GET() {
  let driver: Driver | null = null;
  let session: Session | null = null;

  try {
    driver = createNeo4jDriver();
    session = createNeo4jSession(driver);

    const result = await session.run(`
      MATCH (s)-[r]->(t)
      WHERE type(r) <> 'APPEARED_IN' OR (s:Chapter OR t:Chapter)
      RETURN
        id(s) AS sId,
        s.name AS sName,
        coalesce(labels(s)[1], labels(s)[0], 'Entity') AS sType,
        size([(s)--() | 1]) AS sSize,
        type(r) AS rType,
        r.description AS rDesc,
        r.strength AS rStrength,
        id(t) AS tId,
        t.name AS tName,
        coalesce(labels(t)[1], labels(t)[0], 'Entity') AS tType,
        size([(t)--() | 1]) AS tSize
    `);

    const rows: Neo4jGraphRow[] = result.records.map((record) => ({
      sId: record.get('sId'),
      sName: record.get('sName'),
      sType: record.get('sType'),
      sSize: record.get('sSize'),
      rType: record.get('rType'),
      rDesc: record.get('rDesc'),
      rStrength: record.get('rStrength'),
      tId: record.get('tId'),
      tName: record.get('tName'),
      tType: record.get('tType'),
      tSize: record.get('tSize'),
    }));

    return Response.json(transformNeo4jRowsToForceGraph(rows));
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
