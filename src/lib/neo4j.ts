import neo4j, { type Driver, type Session } from 'neo4j-driver';

export type Neo4jEnvKey =
  | 'NEO4J_URI'
  | 'NEO4J_USERNAME'
  | 'NEO4J_PASSWORD'
  | 'NEO4J_DATABASE';

export const getNeo4jEnv = (key: Neo4jEnvKey): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const createNeo4jDriver = (): Driver => {
  return neo4j.driver(
    getNeo4jEnv('NEO4J_URI'),
    neo4j.auth.basic(getNeo4jEnv('NEO4J_USERNAME'), getNeo4jEnv('NEO4J_PASSWORD')),
  );
};

export const createNeo4jSession = (driver: Driver): Session => {
  return driver.session({ database: getNeo4jEnv('NEO4J_DATABASE') });
};
