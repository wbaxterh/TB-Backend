const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('couch routes load without Drive credentials', () => {
  const previousPath = process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
  process.env.GOOGLE_DRIVE_CREDENTIALS_PATH = path.join(
    os.tmpdir(),
    'tb-missing-google-drive-credentials.json',
  );

  try {
    delete require.cache[require.resolve('../routes/couch')];
    assert.doesNotThrow(() => require('../routes/couch')({ collection: () => ({}) }));
  } finally {
    if (previousPath === undefined) delete process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
    else process.env.GOOGLE_DRIVE_CREDENTIALS_PATH = previousPath;
  }
});
