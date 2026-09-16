const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

const TEST_JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;

function createToken(userId, expiresIn = '1h') {
  return jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn });
}

const TEST_USER_ID = new ObjectId().toString();
const TEST_ADMIN_ID = new ObjectId().toString();
const TEST_OTHER_USER_ID = new ObjectId().toString();
const TEST_SHOP_ID = new ObjectId();

function matchesShopFilter(shop, filter) {
  if (filter.status && shop.status !== filter.status) return false;
  if (filter.$or) {
    return filter.$or.some(
      (cond) =>
        (cond.slug && cond.slug === shop.slug) ||
        (cond._id && cond._id.toString() === shop._id.toString()),
    );
  }
  return true;
}

function matchesCommentFilter(comment, filter) {
  if (filter._id && comment._id.toString() !== filter._id.toString()) return false;
  if (filter.shopId && comment.shopId !== filter.shopId) return false;
  if (filter.parentCommentId !== undefined && comment.parentCommentId !== filter.parentCommentId)
    return false;
  if (filter.status && comment.status !== filter.status) return false;
  return true;
}

function createShopsCollection(shops) {
  return {
    createIndex() {
      return Promise.resolve();
    },
    dropIndex() {
      return Promise.resolve();
    },
    countDocuments() {
      return Promise.resolve(shops.filter((s) => s.status === 'published').length);
    },
    find() {
      return {
        project() {
          return this;
        },
        sort() {
          return this;
        },
        skip() {
          return this;
        },
        limit() {
          return this;
        },
        toArray() {
          return Promise.resolve(shops);
        },
      };
    },
    findOne(filter) {
      const match = shops.find((s) => matchesShopFilter(s, filter));
      return Promise.resolve(match || null);
    },
  };
}

function createShopCommentsCollection(shopCommentsStore) {
  const insertedCommentId = new ObjectId();
  return {
    createIndex() {
      return Promise.resolve();
    },
    countDocuments(filter) {
      return Promise.resolve(
        shopCommentsStore.filter((c) => matchesCommentFilter(c, filter)).length,
      );
    },
    find(filter) {
      let results = shopCommentsStore.filter((c) => matchesCommentFilter(c, filter));
      return {
        sort(spec) {
          const dir = spec.createdAt === -1 ? -1 : 1;
          results = results.sort((a, b) => dir * (a.createdAt - b.createdAt));
          return this;
        },
        skip(n) {
          results = results.slice(n);
          return this;
        },
        limit(n) {
          results = results.slice(0, n);
          return this;
        },
        toArray() {
          return Promise.resolve(results);
        },
      };
    },
    findOne(filter) {
      return Promise.resolve(
        shopCommentsStore.find((c) => matchesCommentFilter(c, filter)) || null,
      );
    },
    insertOne(doc) {
      doc._id = insertedCommentId;
      shopCommentsStore.push(doc);
      return Promise.resolve({ insertedId: insertedCommentId });
    },
    updateOne(filter, update) {
      const comment = shopCommentsStore.find((c) => c._id.toString() === filter._id.toString());
      if (comment && update.$set) Object.assign(comment, update.$set);
      if (comment && update.$inc) {
        for (const [key, val] of Object.entries(update.$inc)) {
          comment[key] = (comment[key] || 0) + val;
        }
      }
      return Promise.resolve({ modifiedCount: comment ? 1 : 0 });
    },
  };
}

function createUsersCollection(users) {
  return {
    find(filter) {
      const ids = filter._id?.$in?.map((id) => id.toString()) || [];
      const results = users.filter((u) => ids.includes(u._id.toString()));
      return {
        project() {
          return this;
        },
        toArray() {
          return Promise.resolve(results);
        },
      };
    },
    findOne(filter) {
      const id = filter._id?.toString();
      return Promise.resolve(users.find((u) => u._id.toString() === id) || null);
    },
  };
}

function createMockDb(options = {}) {
  const { shops = [], shopComments = [], users = [] } = options;
  const shopCommentsStore = [...shopComments];

  return {
    collection(name) {
      if (name === 'shops') return createShopsCollection(shops);
      if (name === 'shop_comments') return createShopCommentsCollection(shopCommentsStore);
      if (name === 'users') return createUsersCollection(users);
      return {
        createIndex() {
          return Promise.resolve();
        },
        dropIndex() {
          return Promise.resolve();
        },
      };
    },
  };
}

async function withServer(db, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/shops', require('../routes/shops')(db));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

// =============================================
// GET /api/shops/:slugOrId/comments tests
// =============================================

test('GET /comments returns 404 for missing shop', async () => {
  const db = createMockDb({ shops: [] });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/nonexistent/comments`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Shop not found');
  });
});

test('GET /comments returns empty array for shop with no comments', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.comments, []);
    assert.equal(body.pagination.totalCount, 0);
    assert.equal(body.pagination.hasMore, false);
  });
});

test('GET /comments returns comments with user info populated', async () => {
  const commentId = new ObjectId();
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [
      {
        _id: commentId,
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_USER_ID,
        parentCommentId: null,
        content: 'Great shop!',
        status: 'active',
        createdAt: new Date(),
      },
    ],
    users: [
      {
        _id: new ObjectId(TEST_USER_ID),
        name: 'Test User',
        imageUri: 'http://example.com/img.jpg',
      },
    ],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.comments.length, 1);
    assert.equal(body.comments[0].content, 'Great shop!');
    assert.equal(body.comments[0].user.name, 'Test User');
    assert.equal(body.pagination.totalCount, 1);
  });
});

test('GET /comments excludes deleted comments', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [
      {
        _id: new ObjectId(),
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_USER_ID,
        parentCommentId: null,
        content: 'Active comment',
        status: 'active',
        createdAt: new Date(),
      },
      {
        _id: new ObjectId(),
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_USER_ID,
        parentCommentId: null,
        content: 'Deleted comment',
        status: 'deleted',
        createdAt: new Date(),
      },
    ],
    users: [{ _id: new ObjectId(TEST_USER_ID), name: 'Test User' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.comments.length, 1);
    assert.equal(body.comments[0].content, 'Active comment');
  });
});

test('GET /comments respects pagination', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [
      {
        _id: new ObjectId(),
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_USER_ID,
        parentCommentId: null,
        content: 'Comment 1',
        status: 'active',
        createdAt: new Date(2024, 0, 1),
      },
      {
        _id: new ObjectId(),
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_USER_ID,
        parentCommentId: null,
        content: 'Comment 2',
        status: 'active',
        createdAt: new Date(2024, 0, 2),
      },
      {
        _id: new ObjectId(),
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_USER_ID,
        parentCommentId: null,
        content: 'Comment 3',
        status: 'active',
        createdAt: new Date(2024, 0, 3),
      },
    ],
    users: [{ _id: new ObjectId(TEST_USER_ID), name: 'Test User' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments?page=1&limit=2`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.comments.length, 2);
    assert.equal(body.pagination.page, 1);
    assert.equal(body.pagination.limit, 2);
    assert.equal(body.pagination.totalCount, 3);
    assert.equal(body.pagination.hasMore, true);
  });
});

test('GET /comments works with shop ID instead of slug', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/${TEST_SHOP_ID.toString()}/comments`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.comments, []);
  });
});

// =============================================
// GET /api/shops/:slugOrId/comments/:commentId/replies tests
// =============================================

test('GET /replies returns 400 for invalid comment ID', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments/invalid-id/replies`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Invalid comment ID');
  });
});

test('GET /replies returns replies for a comment', async () => {
  const parentId = new ObjectId();
  const replyId = new ObjectId();
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [
      {
        _id: parentId,
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_USER_ID,
        parentCommentId: null,
        content: 'Parent',
        status: 'active',
        createdAt: new Date(),
      },
      {
        _id: replyId,
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_OTHER_USER_ID,
        parentCommentId: parentId.toString(),
        content: 'Reply',
        status: 'active',
        createdAt: new Date(),
      },
    ],
    users: [
      { _id: new ObjectId(TEST_USER_ID), name: 'User 1' },
      { _id: new ObjectId(TEST_OTHER_USER_ID), name: 'User 2' },
    ],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/shops/test-shop/comments/${parentId.toString()}/replies`,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.replies.length, 1);
    assert.equal(body.replies[0].content, 'Reply');
    assert.equal(body.replies[0].user.name, 'User 2');
  });
});

// =============================================
// POST /api/shops/:slugOrId/comments tests
// =============================================

test('POST /comments returns 401 without auth token', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Test comment' }),
    });
    assert.equal(res.status, 401);
  });
});

test('POST /comments returns 404 for unpublished shop', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'draft-shop', status: 'draft' }],
    users: [{ _id: new ObjectId(TEST_USER_ID), name: 'Test User' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/draft-shop/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ content: 'Test comment' }),
    });
    assert.equal(res.status, 404);
  });
});

test('POST /comments returns 400 for empty content', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    users: [{ _id: new ObjectId(TEST_USER_ID), name: 'Test User' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ content: '   ' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Comment cannot be empty');
  });
});

test('POST /comments returns 400 for content exceeding max length', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    users: [{ _id: new ObjectId(TEST_USER_ID), name: 'Test User' }],
  });

  await withServer(db, async (baseUrl) => {
    const longContent = 'x'.repeat(501);
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ content: longContent }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('max 500 characters'));
  });
});

test('POST /comments creates comment successfully', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [],
    users: [
      {
        _id: new ObjectId(TEST_USER_ID),
        name: 'Test User',
        imageUri: 'http://example.com/img.jpg',
      },
    ],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ content: 'Great shop!' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.content, 'Great shop!');
    assert.equal(body.userId, TEST_USER_ID);
    assert.equal(body.user.name, 'Test User');
    assert.equal(body.status, 'active');
    assert.ok(body._id);
  });
});

test('POST /comments trims whitespace from content', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [],
    users: [{ _id: new ObjectId(TEST_USER_ID), name: 'Test User' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ content: '  Hello world  ' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.content, 'Hello world');
  });
});

test('POST /comments returns 404 for invalid parent comment', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [],
    users: [{ _id: new ObjectId(TEST_USER_ID), name: 'Test User' }],
  });

  await withServer(db, async (baseUrl) => {
    const fakeParentId = new ObjectId().toString();
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ content: 'Reply', parentCommentId: fakeParentId }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Parent comment not found');
  });
});

test('POST /comments returns 400 for invalid parent comment ID format', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    users: [{ _id: new ObjectId(TEST_USER_ID), name: 'Test User' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ content: 'Reply', parentCommentId: 'not-valid' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Invalid parent comment ID');
  });
});

// =============================================
// DELETE /api/shops/:slugOrId/comments/:commentId tests
// =============================================

test('DELETE /comments returns 401 without auth token', async () => {
  const commentId = new ObjectId();
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [
      {
        _id: commentId,
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_USER_ID,
        content: 'Test',
        status: 'active',
      },
    ],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments/${commentId.toString()}`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 401);
  });
});

test('DELETE /comments returns 400 for invalid comment ID', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    users: [{ _id: new ObjectId(TEST_USER_ID), name: 'Test User' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments/invalid-id`, {
      method: 'DELETE',
      headers: { 'x-auth-token': createToken(TEST_USER_ID) },
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Invalid comment ID');
  });
});

test('DELETE /comments returns 404 for non-existent comment', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [],
    users: [{ _id: new ObjectId(TEST_USER_ID), name: 'Test User' }],
  });

  await withServer(db, async (baseUrl) => {
    const fakeCommentId = new ObjectId().toString();
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments/${fakeCommentId}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': createToken(TEST_USER_ID) },
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Comment not found');
  });
});

test('DELETE /comments returns 403 when non-author non-admin tries to delete', async () => {
  const commentId = new ObjectId();
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [
      {
        _id: commentId,
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_USER_ID,
        content: 'Test',
        status: 'active',
      },
    ],
    users: [{ _id: new ObjectId(TEST_OTHER_USER_ID), name: 'Other User', role: 'user' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments/${commentId.toString()}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': createToken(TEST_OTHER_USER_ID) },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'Access denied');
  });
});

test('DELETE /comments allows author to delete own comment', async () => {
  const commentId = new ObjectId();
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [
      {
        _id: commentId,
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_USER_ID,
        parentCommentId: null,
        content: 'Test',
        status: 'active',
      },
    ],
    users: [{ _id: new ObjectId(TEST_USER_ID), name: 'Test User', role: 'user' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments/${commentId.toString()}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': createToken(TEST_USER_ID) },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, 'Comment deleted');
  });
});

test('DELETE /comments allows admin to delete any comment', async () => {
  const commentId = new ObjectId();
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [
      {
        _id: commentId,
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_USER_ID,
        parentCommentId: null,
        content: 'Test',
        status: 'active',
      },
    ],
    users: [{ _id: new ObjectId(TEST_ADMIN_ID), name: 'Admin User', role: 'admin' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments/${commentId.toString()}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': createToken(TEST_ADMIN_ID) },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, 'Comment deleted');
  });
});

test('DELETE /comments returns 404 for already deleted comment', async () => {
  const commentId = new ObjectId();
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopComments: [
      {
        _id: commentId,
        shopId: TEST_SHOP_ID.toString(),
        userId: TEST_USER_ID,
        content: 'Test',
        status: 'deleted',
      },
    ],
    users: [{ _id: new ObjectId(TEST_USER_ID), name: 'Test User' }],
  });

  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/comments/${commentId.toString()}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': createToken(TEST_USER_ID) },
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Comment not found');
  });
});
