# MongoDB Collections Setup

## Current Collections (from .cursorrules)

- `users`
- `tricklists`
- `tricks`
- `trickipedia`
- `blog`

## Missing Collections for Spot Lists Feature

- `spotlists` - For storing user-created spot lists
- `spots` - For storing individual skate spots

## How to Create the Missing Collections

### Option 1: MongoDB Atlas Dashboard (Recommended)

1. **Go to MongoDB Atlas**

   - Navigate to your cluster
   - Click on "Browse Collections"

2. **Create spotlists collection**

   - Select your `TrickList2` database
   - Click "Create Collection"
   - Name: `spotlists`
   - Click "Create"

3. **Create spots collection**
   - Click "Create Collection" again
   - Name: `spots`
   - Click "Create"

### Option 2: MongoDB Shell Commands

```javascript
// Connect to your database
use TrickList2

// Create spotlists collection
db.createCollection("spotlists")

// Create spots collection
db.createCollection("spots")

// Verify collections exist
show collections
```

### Option 3: Let MongoDB Create Automatically

The collections will be created automatically when you first insert data, but it's better to create them explicitly.

## Update Configuration

### Update .cursorrules

```json
{
	"collections": [
		"users",
		"tricklists",
		"tricks",
		"trickipedia",
		"blog",
		"spotlists",
		"spots"
	]
}
```

### Collection Schemas

#### spotlists Collection

```javascript
{
  "_id": ObjectId,
  "name": String,           // List name
  "description": String,    // Optional description
  "userId": ObjectId,       // Reference to user
  "spotIds": [ObjectId],    // Array of spot references
  "createdAt": Date,
  "updatedAt": Date
}
```

#### spots Collection

```javascript
{
  "_id": ObjectId,
  "name": String,           // Spot name
  "latitude": Number,       // GPS coordinates
  "longitude": Number,
  "imageURL": String,       // Optional image
  "description": String,    // Optional description
  "rating": Number,         // 0-5 rating
  "tags": String,           // Comma-separated tags
  "city": String,           // City name
  "state": String           // State name
}
```

## Test the Collections

### Test spotlists endpoint

```bash
curl -X GET "https://api.thetrickbook.com/api/spotlists" \
  -H "x-auth-token: YOUR_TOKEN"
```

### Test spots endpoint

```bash
curl -X GET "https://api.thetrickbook.com/api/spots" \
  -H "x-auth-token: YOUR_TOKEN"
```

## Indexes (Optional but Recommended)

### For spots collection

```javascript
// Create index on coordinates for fast lookups
db.spots.createIndex({ latitude: 1, longitude: 1 });

// Create text index for name searches
db.spots.createIndex({ name: "text" });
```

### For spotlists collection

```javascript
// Create index on userId for fast user queries
db.spotlists.createIndex({ userId: 1 });

// Create index on spotIds for fast spot lookups
db.spotlists.createIndex({ spotIds: 1 });
```

## Verification Steps

1. **Check collections exist**

   ```javascript
   use TrickList2
   show collections
   ```

2. **Test API endpoints**

   - GET `/api/spotlists` should return empty array `[]`
   - GET `/api/spots` should return empty array `[]`

3. **Create a test spot list**

   ```bash
   curl -X POST "https://api.thetrickbook.com/api/spotlists" \
     -H "Content-Type: application/json" \
     -H "x-auth-token: YOUR_TOKEN" \
     -d '{"name": "Test List", "description": "Test description"}'
   ```

4. **Verify in MongoDB**
   ```javascript
   db.spotlists.find().pretty();
   ```

## Troubleshooting

### If collections don't appear

- Check database name is correct (`TrickList2`)
- Verify MongoDB connection string
- Check user permissions

### If API returns errors

- Check collection names match exactly
- Verify authentication token
- Check server logs for detailed errors

### If data isn't saving

- Check MongoDB connection
- Verify schema matches expected format
- Check for validation errors

## Next Steps

After creating the collections:

1. **Test the Chrome extension** - Try logging in and creating a spot list
2. **Test spot syncing** - Try scraping and syncing spots
3. **Monitor performance** - Add indexes if queries are slow
4. **Backup strategy** - Set up regular backups for the new collections

The collections should be created automatically when you first use the API, but creating them explicitly ensures proper setup and allows you to add indexes and validation rules.
