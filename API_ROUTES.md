# TrickBook API Routes

## Authentication Routes (`/api/auth`)

- `POST /api/auth` - Regular email/password login
- `POST /api/auth/google-auth` - Google SSO authentication

## User Routes (`/api/user`)

- `GET /api/user/me` - Get current user profile
- `PUT /api/user` - Update user profile

## Users Routes (`/api/users`)

- `POST /api/users` - Register new user
- `GET /api/users` - Get user by email
- `GET /api/users/all` - Get all users
- `DELETE /api/users/:id` - Delete user (requires authAccountOrAdmin)

## Listings Routes (`/api/listings`)

- `GET /api/listings` - Get all listings with filters
- `POST /api/listings` - Create new listing
- `GET /api/listings/countTrickLists` - Get count of trick lists
- `GET /api/listings/all` - Get all trick lists

## Listing Routes (`/api/listing`)

- `PUT /api/listing/edit` - Edit listing
- `DELETE /api/listing/:id` - Delete listing

## Messages Routes (`/api/messages`)

- `GET /api/messages` - Get user messages
- `POST /api/messages` - Send message

## Blog Routes (`/api/blog`)

- `GET /api/blog` - Get blog posts
- `POST /api/blog` - Create blog post
- `PUT /api/blog/:id` - Update blog post
- `DELETE /api/blog/:id` - Delete blog post

## Blog Image Routes (`/api/blogImage`)

- `POST /api/blogImage` - Upload blog image

## Categories Routes (`/api/categories`)

- `GET /api/categories` - Get all categories

## Contact Routes (`/api/contact`)

- `POST /api/contact` - Send contact form

## Health (`/health`, `/api/health`)

- `GET /health` - Liveness/readiness probe (no auth). Pings the database; 200 `{ status: "ok" }` or 503 `{ status: "degraded" }`. The body carries version, uptime and db latency only.

## Shops Routes (`/api/shops`)

### Shop Directory

- `GET /api/shops` - List published shops with filters and pagination
  - Query params: `cursor`, `limit`, `sport`, `service`, `q` (search), `location`
  - Response: `{ shops: [...], nextCursor, totalCount }`
  - Each shop includes `userRating: { averageRating: number|null, ratingCount: number }`
- `GET /api/shops/:slugOrId` - Get shop detail by slug or ObjectId
  - Response: `{ shop: { ...shopFields, userRating: { averageRating, ratingCount } } }`

### Shop Comments

- `GET /api/shops/:slugOrId/comments` - List comments (public, paginated)
  - Query params: `page`, `limit`
  - Response: `{ comments: [...], pagination: { page, limit, totalCount, hasMore } }`
- `GET /api/shops/:slugOrId/comments/:commentId/replies` - List replies to a comment
  - Query params: `page`, `limit`
  - Response: `{ replies: [...], pagination: { page, limit, hasMore } }`
- `POST /api/shops/:slugOrId/comments` - Create comment (auth required)
  - Body: `{ content: string, parentCommentId?: string }`
  - Response: the created comment with user info
- `DELETE /api/shops/:slugOrId/comments/:commentId` - Delete comment (auth, owner or admin)
  - Response: `{ message: "Comment deleted" }`

### Shop Ratings (TrickBook Community Ratings)

User star ratings for shops, separate from the imported Google `reviewSummary` field.

- `GET /api/shops/:slugOrId/ratings` - Get rating summary (public, myRating if authenticated)
  - Response: `{ averageRating: number|null, ratingCount: number, distribution: {"1":n,"2":n,"3":n,"4":n,"5":n}, myRating: number|null }`
  - `averageRating` is rounded to one decimal place, or `null` if no ratings exist
  - `myRating` is included only when a valid auth token is provided
- `PUT /api/shops/:slugOrId/rating` - Upsert the caller's rating (auth required)
  - Body: `{ rating: 1-5 }` (integer)
  - Response: same shape as GET /ratings
  - Creates a new rating or updates the existing one for this user
- `DELETE /api/shops/:slugOrId/rating` - Remove the caller's rating (auth required)
  - Response: same shape as GET /ratings
  - Idempotent: returns success even if no rating existed

## Image Routes (`/api/image`)

- `GET /api/image` - Default avatar
- `POST /api/image` - Upload the caller's avatar (auth required; target is the token holder, multipart field `file`, images only, 25 MB max)

## My Routes (`/api/my`)

- `GET /api/my` - Get user's data

## Expo Push Tokens Routes (`/api/expoPushTokens`)

- `POST /api/expoPushTokens` - Register push notification token

## Authentication Requirements

### Protected Routes (Require JWT Token)

- All routes except:
  - `POST /api/auth`
  - `POST /api/auth/google-auth`
  - `POST /api/users` (registration)
  - `GET /api/categories`

### Admin-Only Routes

- `DELETE /api/users/:id` (requires admin or account owner)

## Request Headers

- `x-auth-token`: JWT token for authentication
- `Authorization`: Bearer token for some endpoints

## Response Formats

- Success responses typically include the requested data
- Error responses include an `error` field with the error message
- Status codes:
  - 200: Success
  - 201: Created
  - 400: Bad Request
  - 401: Unauthorized
  - 403: Forbidden
  - 404: Not Found
  - 500: Server Error
