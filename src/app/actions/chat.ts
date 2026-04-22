'use server';

import neo4j, { type Driver, type Session } from 'neo4j-driver';
import { createNeo4jDriver, createNeo4jSession } from '@/lib/neo4j';

type SerializedRecord = Record<string, unknown>;

export type AskGraphQuestionResult = {
  answer: string;
  cypher: string;
  cypherDebug: string;
  rows: SerializedRecord[];
  mentions: string[];
};

const GRAPH_SCHEMA_HINT = `
Schema:
- Nodes:
  - Character {name}
  - Location {name}
  - Organization {name}
  - Chapter {title}
- Relationships:
  - (Character)-[:APPEARED_IN]->(Chapter)
  - (Character)-[:LIVES_IN]->(Location)
  - (Character)-[:MEMBER_OF]->(Organization)

Guidance:
- To find when someone first appeared, match the character to all chapters and sort by chapter title.
- Always include relationship types and connected node names in RETURN.
- Use OPTIONAL MATCH to enrich context when direct matches may miss required details.
- The database is entirely in English.
- If the user asks in Hebrew, first translate entities (characters, locations, items, organizations) to their English canonical names before writing Cypher.
- Even after translating entities, keep query matching fuzzy with toLower(...) + CONTAINS so translation variations still match.
`;

const WRITE_PATTERN =
  /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD CSV|APOC|CALL\s+dbms|FOREACH)\b/i;

const normalizeCypher = (raw: string): string => {
  const withoutCodeFence = raw
    .replace(/```cypher/gi, '')
    .replace(/```/g, '')
    .trim();

  const singleStatement = withoutCodeFence.split(';')[0]?.trim() ?? '';
  return singleStatement;
};

const cleanCypherQuery = (query: string): string => {
  let cleaned = query.trim();

  // Strip fenced code blocks like ```cypher ... ``` or ```json ... ```
  cleaned = cleaned.replace(/```(?:cypher|json)?\s*([\s\S]*?)```/gi, '$1').trim();

  // Remove standalone leading language tags left by models
  cleaned = cleaned.replace(/^(?:cypher|json)\s*/i, '').trim();

  // Remove stray backticks
  cleaned = cleaned.replace(/`+/g, '').trim();

  return cleaned;
};

const extractCypherAndDebug = (
  raw: string,
): {
  cypher: string;
  debug: string;
} => {
  const trimmed = raw.trim();

  try {
    const parsed = JSON.parse(trimmed) as { cypher?: string; debug?: string };
    if (typeof parsed.cypher === 'string') {
      return {
        cypher: parsed.cypher.trim(),
        debug: typeof parsed.debug === 'string' ? parsed.debug.trim() : '',
      };
    }
  } catch {
    // Fallback to plain text parsing below.
  }

  return { cypher: normalizeCypher(trimmed), debug: '' };
};

const ensureReadOnlyCypher = (cypher: string): string => {
  if (!cypher) {
    throw new Error('The model did not generate a Cypher query.');
  }

  if (WRITE_PATTERN.test(cypher)) {
    throw new Error('Generated Cypher contained write operations and was rejected.');
  }

  const hasReturn = /\bRETURN\b/i.test(cypher);
  if (!hasReturn) {
    throw new Error('Generated Cypher must include RETURN.');
  }

  if (!/\bLIMIT\b/i.test(cypher)) {
    return `${cypher}\nLIMIT 50`;
  }

  return cypher;
};

const getOpenAiApiKey = (): string | null => process.env.OPENAI_API_KEY ?? null;
const getAnthropicApiKey = (): string | null => process.env.ANTHROPIC_API_KEY ?? null;

const askOpenAI = async (
  systemPrompt: string,
  userPrompt: string,
  model?: string,
): Promise<string> => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('OpenAI returned an empty response.');
  }
  return content;
};

const askAnthropic = async (
  systemPrompt: string,
  userPrompt: string,
  model?: string,
): Promise<string> => {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is missing');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
      temperature: 0,
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic request failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const textPart = json.content?.find((part) => part.type === 'text')?.text?.trim();
  if (!textPart) {
    throw new Error('Anthropic returned an empty response.');
  }
  return textPart;
};

const askLLM = async (
  systemPrompt: string,
  userPrompt: string,
  modelPreference?: { openai: string; anthropic: string },
): Promise<string> => {
  if (getOpenAiApiKey()) {
    return askOpenAI(systemPrompt, userPrompt, modelPreference?.openai);
  }
  if (getAnthropicApiKey()) {
    return askAnthropic(systemPrompt, userPrompt, modelPreference?.anthropic);
  }
  throw new Error('Missing OPENAI_API_KEY or ANTHROPIC_API_KEY in environment.');
};

type GraphSchema = {
  labels: string[];
  relationshipTypes: string[];
};

const fetchGraphSchema = async (session: Session): Promise<GraphSchema> => {
  // Neo4j sessions do not support concurrent queries on the same session.
  const labelResult = await session.run('CALL db.labels() YIELD label RETURN label');
  const relResult = await session.run(
    'CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType',
  );

  const labels = labelResult.records
    .map((record) => String(record.get('label')))
    .filter((value) => value.length > 0)
    .sort((a, b) => a.localeCompare(b));

  const relationshipTypes = relResult.records
    .map((record) => String(record.get('relationshipType')))
    .filter((value) => value.length > 0)
    .sort((a, b) => a.localeCompare(b));

  return { labels, relationshipTypes };
};

const serializeNeo4jValue = (value: unknown): unknown => {
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeNeo4jValue(item));
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    if ('labels' in obj && 'properties' in obj) {
      return {
        elementId: obj.elementId,
        labels: serializeNeo4jValue(obj.labels),
        properties: serializeNeo4jValue(obj.properties),
      };
    }

    if ('type' in obj && 'startNodeElementId' in obj && 'endNodeElementId' in obj) {
      return {
        elementId: obj.elementId,
        type: obj.type,
        startNodeElementId: obj.startNodeElementId,
        endNodeElementId: obj.endNodeElementId,
        properties: serializeNeo4jValue(obj.properties),
      };
    }

    return Object.fromEntries(
      Object.entries(obj).map(([key, nested]) => [key, serializeNeo4jValue(nested)]),
    );
  }

  return value;
};

const serializeRecords = (
  records: Array<{ keys: PropertyKey[]; get: (key: PropertyKey) => unknown }>,
) => {
  return records.map((record) => {
    const row: SerializedRecord = {};
    for (const rawKey of record.keys) {
      const key = String(rawKey);
      row[key] = serializeNeo4jValue(record.get(rawKey));
    }
    return row;
  });
};

const extractMentions = (answer: string): string[] => {
  const matches = answer.matchAll(/\[\[([^[\]]+)\]\]/g);
  const names = new Set<string>();
  for (const match of matches) {
    const name = match[1]?.trim();
    if (name) {
      names.add(name);
    }
  }
  return Array.from(names);
};

export async function askGraphQuestion(question: string): Promise<AskGraphQuestionResult> {
  const trimmedQuestion = question.trim();
  if (trimmedQuestion.length < 2) {
    throw new Error('Please enter a longer question.');
  }

  let driver: Driver | null = null;
  let session: Session | null = null;

  try {
    driver = createNeo4jDriver();
    session = createNeo4jSession(driver);
    const schema = await fetchGraphSchema(session);

    const availableLabels = schema.labels.join(', ');
    const availableRelationships = schema.relationshipTypes.join(', ');
    const cypherSystem = `You translate user questions into Cypher for Neo4j.\n${GRAPH_SCHEMA_HINT}

Dynamic schema from database right now:
- Available labels: ${availableLabels}
- Available relationship types: ${availableRelationships}
`;
    const cypherUser = `Question: ${trimmedQuestion}

Rules:
- Output ONLY the raw Cypher query.
- Do not use Markdown.
- Do not use backticks.
- Do not explain anything.
- Query must be read-only.
- Use WHERE toLower(n.name) CONTAINS toLower('keyword') for entity matching (not strict equality).
- If the user question is in Hebrew, translate entity names to English canonical names before writing Cypher.
- You must ONLY use relationship types from the provided available relationship types list.
- If you do not find an exact relationship name, use a generic pattern ()-[r]-() and filter with WHERE type(r) CONTAINS 'KEYWORD'.
- Always include relationship types and connected node names in RETURN.
- Include available relationship "description" fields in RETURN when they exist, so downstream answering can explain how/why the relationship exists.
- Prefer OPTIONAL MATCH for additional relationships/context when direct matches may miss details.
- For first appearance/debut, traverse (c:Character)-[:APPEARED_IN]->(ch:Chapter) and sort by chapter title.`;

    const rawCypher = await askLLM(cypherSystem, cypherUser, {
      openai: process.env.OPENAI_CYPHER_MODEL ?? 'gpt-4o',
      anthropic: process.env.ANTHROPIC_CYPHER_MODEL ?? 'claude-sonnet-4-6',
    });
    const extracted = extractCypherAndDebug(rawCypher);
    const cypher = ensureReadOnlyCypher(cleanCypherQuery(extracted.cypher));
    const cypherDebug = extracted.debug || cypher;

    let limitedRows: SerializedRecord[] = [];

    try {
      const result = await session.run(cypher);
      const rows = serializeRecords(result.records);
      limitedRows = rows.slice(0, 40);
    } catch {
      return {
        answer:
          "I could not complete that graph lookup. I tried to find matching nodes and relationships in the schema (Character, Location, Organization, Chapter), but the generated graph query did not execute successfully.",
        cypher,
        cypherDebug,
        rows: [],
        mentions: [],
      };
    }

    if (limitedRows.length === 0) {
      return {
        answer:
          "I checked the graph for matching nodes and relationships, but found no relevant results for that question. I looked for connected entities and relationship paths based on your request.",
        cypher,
        cypherDebug,
        rows: [],
        mentions: [],
      };
    }

    const answerSystem = `You answer questions about One Piece using only graph query results.

Rules:
- If results are empty, say that the graph does not contain enough data.
- Do not invent facts outside supplied rows.
- Keep answer concise and clear.
- Include names of relevant nodes in the answer.
- If relationship types appear in results (example: ACCIDENTALLY_ATE), use the exact relationship phrasing in your response.
- Always respond in the same language as the user question (Hebrew question -> Hebrew answer).
- If a relationship description field is present, use it to explain the "how" or "why" behind the relationship.
- Wrap each relevant node name in double square brackets, for example [[Monkey D. Luffy]].`;

    const answerUser = `User question: ${trimmedQuestion}
Executed Cypher:
${cypher}

Graph rows (JSON):
${JSON.stringify(limitedRows, null, 2)}`;

    const answer = await askLLM(answerSystem, answerUser);
    const mentions = extractMentions(answer);

    return {
      answer,
      cypher,
      cypherDebug,
      rows: limitedRows,
      mentions,
    };
  } finally {
    if (session) {
      await session.close();
    }
    if (driver) {
      await driver.close();
    }
  }
}
