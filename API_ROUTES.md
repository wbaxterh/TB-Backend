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

## Image Routes (`/api/image`)

- `POST /api/image` - Upload image

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
