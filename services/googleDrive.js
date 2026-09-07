const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

function credentialsPath() {
  return path.resolve(
    process.env.GOOGLE_DRIVE_CREDENTIALS_PATH || './config/google-drive-credentials.json',
  );
}

function missingCredentialsError(credPath) {
  const error = new Error(`Google Drive credentials not found at ${credPath}`);
  error.code = 'DRIVE_CREDENTIALS_MISSING';
  return error;
}

function getDriveClient() {
  const credPath = credentialsPath();
  if (!fs.existsSync(credPath)) {
    throw missingCredentialsError(credPath);
  }

  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    const error = new Error('GOOGLE_DRIVE_FOLDER_ID is not set');
    error.code = 'DRIVE_FOLDER_MISSING';
    throw error;
  }

  const authClient = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  return {
    drive: google.drive({ version: 'v3', auth: authClient }),
    folderId,
  };
}

module.exports = { getDriveClient };
