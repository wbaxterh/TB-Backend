# TrickBook Backend - Claude Code Rules

## CRITICAL: Security Rules

### Never Hardcode Secrets
**NEVER** write credentials, API keys, passwords, or connection strings directly in code files.

**FORBIDDEN patterns:**
```javascript
// NEVER DO THIS:
const ATLAS_URI = "mongodb+srv://user:password@cluster...";
const API_KEY = "sk_live_...";
const SECRET = "abc123...";
```

**REQUIRED patterns:**
```javascript
// ALWAYS DO THIS:
require('dotenv').config();

if (!process.env.ATLAS_URI) {
  console.error('ERROR: ATLAS_URI not set');
  process.exit(1);
}
const ATLAS_URI = process.env.ATLAS_URI;
```

### Environment Variables
All sensitive configuration MUST come from environment variables:
- `ATLAS_URI` - MongoDB connection string
- `AWS_KEY`, `AWS_SECRET` - AWS credentials
- `STRIPE_SECRET_KEY` - Stripe API key
- `JWT_SECRET` - JWT signing secret
- `BUNNY_API_KEY`, `BUNNY_LIBRARY_API_KEY` - Bunny.net keys
- `GOOGLE_PLACES_API_KEY` - Google API key
- `EMAIL_PASSWORD` - Email credentials

### Before Committing
When creating or modifying any file that connects to a database or external service:
1. Ensure it uses `require('dotenv').config()` at the top
2. Ensure it reads from `process.env.*`
3. Add validation that throws/exits if required env vars are missing
4. NEVER use fallback values that contain real credentials

### Files to Watch
Be especially careful with:
- Any file in `/scripts/`
- Any file in `/routes/`
- Any standalone `.js` files in the root
- Any file that imports `mongoose` or database clients

## Project Structure

- `/routes/` - Express route handlers
- `/middleware/` - Express middleware
- `/scripts/` - Utility scripts (seeding, migrations, etc.)
- `/config/` - Configuration files (credentials go in .env, NOT here)
- `.env` - Environment variables (NEVER commit this file)

## Database

- MongoDB Atlas cluster: `cluster0.v1sxt.gcp.mongodb.net`
- Always use the `ATLAS_URI` from environment
- Database name: `myFirstDatabase`
