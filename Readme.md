# TrickBook Backend

This is the backend service for the TrickBook application, a platform for skateboarders to track their trick progress, share listings, and connect with other skaters.

## Architecture Overview

The backend is built with Node.js and Express, using MongoDB as the database. It serves as the API layer for both the React Native mobile app and the Next.js web application.

### Key Components

- **Authentication**: JWT-based auth with support for both email/password and Google SSO
- **Image Processing**: Handles image uploads and resizing for listings and user profiles
- **Real-time Features**: Push notifications for messages and updates
- **MongoDB Collections**:
  - Users
  - Listings (User Trick Lists)
  - Tricks (User-specific)
  - Trickipedia (Global tricks encyclopedia)
  - Messages
  - Blog Posts
  - Categories

## API Endpoints

### Authentication

- `POST /api/auth` - Regular email/password login
- `POST /api/auth/google-auth` - Google SSO authentication

### User Management

- `GET /api/user/me` - Get current user profile
- `GET /api/users` - Get users (admin only)
- `PUT /api/user` - Update user profile
- `DELETE /api/users/:id` - Delete user (requires account owner or admin)

### Listings (User Trick Lists)

- `GET /api/listings` - Get all trick lists for a user (each list is a collection of tricks)
- `POST /api/listings` - Create new trick list
- `GET /api/listings/countTrickLists` - Get count of trick lists
- `GET /api/listings/all` - Get all trick lists

### Listing (Tricks in a Trick List)

- `GET /api/listing` - Get all tricks in a specific trick list (by list_id)
- `PUT /api/listing/:id` - Update a trick in a trick list
- `PUT /api/listing/edit` - Edit a trick in a trick list
- `PUT /api/listing/update` - Update trick completion status
- `POST /api/listing` - Add a new trick to a trick list
- `DELETE /api/listing/:id` - Delete a trick from a trick list
- `GET /api/listing/allData` - Get all tricks (admin/debug)
- `GET /api/listing/allTricks` - Get all tricks for a user (flattened)
- `GET /api/listing/graph` - Get trick completion graph data

### Trickipedia (Global Tricks Encyclopedia)

- `GET /api/trickipedia` - Get all tricks (with optional filtering: `?category=...&difficulty=...&search=...`)
- `GET /api/trickipedia/category/:category` - Get tricks by category (with optional filtering)
- `GET /api/trickipedia/:id` - Get a single trick by ID
- `POST /api/trickipedia` - Create a new trick (admin only)
- `PUT /api/trickipedia/:id` - Update a trick (admin only)
- `DELETE /api/trickipedia/:id` - Delete a trick (admin only)

> **Note:**
>
> - **Trickipedia** is a global, admin-curated encyclopedia of tricks (not user-specific).
> - **Listings/Trick Lists** (`/api/listings`) are user-specific collections of tricks for tracking personal progress.
> - **Listing** (`/api/listing`) is for CRUD operations on individual tricks within a user's trick list.

### Messages

- `GET /api/messages`
