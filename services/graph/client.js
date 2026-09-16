const DEFAULT_DATABASE = 'neo4j';

function graphEnabled(env = process.env) {
  return (
    env.NEO4J_ENABLED === 'true' &&
    Boolean(env.NEO4J_URI && env.NEO4J_USERNAME && env.NEO4J_PASSWORD)
  );
}

function createGraphClient(env = process.env, fetchImpl = global.fetch) {
  const enabled = graphEnabled(env);
  const baseUrl = (env.NEO4J_URI || '').replace(/\/$/, '');
  const database = env.NEO4J_DATABASE || DEFAULT_DATABASE;
  const timeoutMs = Math.max(500, Number.parseInt(env.NEO4J_TIMEOUT_MS, 10) || 3000);

  async function run(statement, parameters = {}) {
    if (!enabled) throw new Error('Neo4j is disabled');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}/db/${encodeURIComponent(database)}/tx/commit`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${env.NEO4J_USERNAME}:${env.NEO4J_PASSWORD}`).toString('base64')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          statements: [{ statement, parameters, resultDataContents: ['row'] }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Neo4j HTTP ${response.status}`);
      const body = await response.json();
      if (body.errors?.length) throw new Error(`Neo4j: ${body.errors[0].message}`);
      return body.results?.[0]?.data?.map((item) => item.row) || [];
    } finally {
      clearTimeout(timer);
    }
  }

  return { enabled, run };
}

module.exports = { createGraphClient, graphEnabled };
