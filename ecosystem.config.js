module.exports = {
  apps: [
    {
      name: 'TB-Backend',
      script: 'node index.js',
      version: '1.0.0',
    },
    {
      name: 'kaori-rag-indexer',
      script: 'scripts/index-kaori-rag.js',
      cron_restart: '15 3 * * *',
      autorestart: false,
      watch: false,
    },
    {
      name: 'companion-graph-builder',
      script: 'scripts/build-companion-graph.js',
      cron_restart: '30 3 * * *',
      autorestart: false,
      watch: false,
    },
  ],
};
