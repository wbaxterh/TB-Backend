const fs = require('fs');
const path = require('path');

const registry = new Map();

function register(id, config) {
  const normalized = String(id || '')
    .trim()
    .toLowerCase();
  if (!normalized || !config?.intro || !Array.isArray(config.messageExamples)) return;
  registry.set(normalized, {
    voice: [],
    identityNotes: [],
    knows: [],
    toolGuidance: { intro: '', routes: [], rules: [] },
    dont: [],
    laugh: '',
    vibe: '',
    ...config,
    id: normalized,
    displayName: config.displayName || normalized,
  });
}

register('kaori', require('./kaori-character.json'));

const configDir = path.join(__dirname, 'companions');
if (fs.existsSync(configDir)) {
  for (const filename of fs.readdirSync(configDir).filter((name) => name.endsWith('.json'))) {
    const config = require(path.join(configDir, filename));
    register(config.id || path.basename(filename, '.json'), config);
  }
}

function getCompanion(id) {
  return registry.get(String(id || '').toLowerCase()) || null;
}

function hasCompanion(id) {
  return Boolean(getCompanion(id));
}

function listCompanions() {
  return [...registry.values()].map(({ id, displayName }) => ({ id, displayName }));
}

module.exports = { getCompanion, hasCompanion, listCompanions, register };
