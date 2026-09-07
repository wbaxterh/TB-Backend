const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getDriveClient } = require('../services/googleDrive');

test('getDriveClient throws when the credentials file is missing', () => {
  const previousPath = process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
  const previousFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  process.env.GOOGLE_DRIVE_CREDENTIALS_PATH = path.join(
    os.tmpdir(),
    'tb-missing-google-drive-credentials.json',
  );
  process.env.GOOGLE_DRIVE_FOLDER_ID = 'folder';

  try {
    assert.throws(() => getDriveClient(), { code: 'DRIVE_CREDENTIALS_MISSING' });
  } finally {
    if (previousPath === undefined) delete process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
    else process.env.GOOGLE_DRIVE_CREDENTIALS_PATH = previousPath;
    if (previousFolder === undefined) delete process.env.GOOGLE_DRIVE_FOLDER_ID;
    else process.env.GOOGLE_DRIVE_FOLDER_ID = previousFolder;
  }
});

test('getDriveClient throws when the Drive folder id is missing', () => {
  const previousPath = process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
  const previousFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const credPath = path.join(os.tmpdir(), `tb-drive-creds-${process.pid}.json`);
  fs.writeFileSync(
    credPath,
    JSON.stringify({
      type: 'service_account',
      client_email: 'dev@example.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n',
    }),
  );

  process.env.GOOGLE_DRIVE_CREDENTIALS_PATH = credPath;
  delete process.env.GOOGLE_DRIVE_FOLDER_ID;

  try {
    assert.throws(() => getDriveClient(), { code: 'DRIVE_FOLDER_MISSING' });
  } finally {
    fs.unlinkSync(credPath);
    if (previousPath === undefined) delete process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
    else process.env.GOOGLE_DRIVE_CREDENTIALS_PATH = previousPath;
    if (previousFolder === undefined) delete process.env.GOOGLE_DRIVE_FOLDER_ID;
    else process.env.GOOGLE_DRIVE_FOLDER_ID = previousFolder;
  }
});

test('couch routes load without Drive credentials', () => {
  const previousPath = process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
  process.env.GOOGLE_DRIVE_CREDENTIALS_PATH = path.join(
    os.tmpdir(),
    'tb-missing-google-drive-credentials.json',
  );

  try {
    const couchPath = require.resolve('../routes/couch');
    const drivePath = require.resolve('../services/googleDrive');
    delete require.cache[couchPath];
    delete require.cache[drivePath];
    const createCouchRouter = require('../routes/couch');
    assert.doesNotThrow(() => createCouchRouter({ collection: () => ({}) }));
  } finally {
    if (previousPath === undefined) delete process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
    else process.env.GOOGLE_DRIVE_CREDENTIALS_PATH = previousPath;
  }
});
