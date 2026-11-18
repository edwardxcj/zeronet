import { createHash } from "node:crypto";

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;
const isId = (value) => typeof value === "string" && idPattern.test(value);
const pageSize = 20;
const actions = new Set([
  "createComment", "listComments", "getComment", "deleteComment", "commentCount", "setLike", "getLikes",
  "listNotifications", "unreadCount", "markNotificationRead", "markAllNotificationsRead",
]);

export class SocialError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const diagnosticTypes = new Set([
  "document_not_found", "collection_not_found", "database_not_found", "document_already_exists",
  "document_invalid_structure", "attribute_unknown", "attribute_not_found", "index_not_found",
  "index_invalid", "query_invalid", "query_type_invalid", "query_cursor_not_found",
  "transaction_not_found", "transaction_conflict", "transaction_limit_exceeded",
  "user_unauthorized", "general_unauthorized_scope", "general_unauthorized", "general_argument_invalid",
  "general_unknown", "general_server_error", "general_rate_limit_exceeded", "relationship_value_invalid",
]);
export class SocialUpstreamError extends Error {
  constructor(response, detail) {
    super("Appwrite social operation failed");
    this.status = response.status;
    this.type = diagnosticTypes.has(detail.type) ? detail.type : "unclassified";
    this.operation = response.socialOperation ?? "request";
  }
}

export function isSocialAction(action) { return actions.has(action); }

export function validSocialRequest(body) {
  const cursorValid = body.cursor === undefined || isId(body.cursor);
  switch (body.action) {
    case "createComment":
      return isId(body.postId) && typeof body.content === "string" &&
        body.content.trim().length > 0 && body.content.trim().length <= 2000 &&
        typeof body.requestId === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId) &&
        (body.parentId === undefined || isId(body.parentId));
    case "listComments":
      return isId(body.postId) && (body.rootId === undefined || isId(body.rootId)) && cursorValid;
    case "getComment": case "deleteComment": return isId(body.commentId);
    case "commentCount": case "getLikes": return isId(body.postId);
    case "setLike": return isId(body.postId) && typeof body.shouldLike === "boolean";
    case "listNotifications": return cursorValid;
    case "markNotificationRead": return isId(body.id);
    case "unreadCount": case "markAllNotificationsRead": return true;
    default: return false;
  }
}

function stableId(...parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 36);
}

const equal = (attribute, value) => ({ method: "equal", attribute, values: [value] });
const limit = (value) => ({ method: "limit", values: [value] });
const select = (values) => ({ method: "select", values });
const order = (method, attribute) => ({ method, attribute });
function queryPath(path, queries = [], transactionId) {
  const params = new URLSearchParams(queries.map((q, i) => [`queries[${i}]`, JSON.stringify(q)]));
  if (transactionId) params.set("transactionId", transactionId);
  return params.size ? `${path}?${params}` : path;
}

async function read(response, { missing = false } = {}) {
  if (response.ok) return response.status === 204 ? null : response.json();
  const detail = await response.json().catch(() => ({}));
  if (missing && response.status === 404 && detail.type === "document_not_found") return null;
  if (response.status === 409) throw new SocialError(409, "The data changed. Please try again.");
  throw new SocialUpstreamError(response, detail);
}

function publicProfile(profile) {
  if (!isId(profile?.$id)) return null;
  return {
    $id: profile.$id,
    name: typeof profile.name === "string" ? profile.name : "ZeroNet member",
    username: typeof profile.username === "string" ? profile.username : "",
    imageUrl: typeof profile.imageUrl === "string" ? profile.imageUrl : "",
  };
}

// Only the verified JWT's account is authoritative. Body fields never identify the actor.
export function createSocialService({ request, userRequest, collections, usersPath, postsCollectionId, actorId }) {
  const commentsPath = `${collections}/comments/documents`;
  const notificationsPath = `${collections}/notifications/documents`;
  const postsPath = `${collections}/${encodeURIComponent(postsCollectionId)}/documents`;
  const docPath = (path, id) => `${path}/${encodeURIComponent(id)}`;
  const get = (path, tx, missing = false) => request(queryPath(path, [], tx)).then((r) => read(r, { missing }));
  const list = async (path, queries, tx) => {
    const result = await read(await request(queryPath(path, queries, tx)));
    if (!Array.isArray(result?.documents) || !Number.isSafeInteger(result.total) || result.total < 0) {
      throw new Error("Invalid social page");
    }
    return result;
  };
  const update = async (path, data, tx) => {
    const response = await request(path, {
      method: "PATCH", data: { data, ...(tx ? { transactionId: tx } : {}) },
    });
    if (tx && response.status === 404) throw new SocialError(409, "The data changed. Please try again.");
    return read(response);
  };
  const create = (path, id, data, tx) => request(path, {
    method: "POST", data: { documentId: id, data, permissions: [], ...(tx ? { transactionId: tx } : {}) },
  }).then(read);
  const remove = async (path, tx) => read(await request(queryPath(path, [], tx), { method: "DELETE" }), { missing: true });

  async function profilesByAccount(accountIds) {
    const ids = [...new Set(accountIds.filter(isId))];
    if (!ids.length) return new Map();
    const page = await list(usersPath, [
      { method: "equal", attribute: "accountId", values: ids }, limit(100),
      select(["$id", "accountId", "name", "username", "imageUrl"]),
    ]);
    const result = new Map();
    for (const profile of page.documents) {
      if (ids.includes(profile.accountId) && publicProfile(profile)) result.set(profile.accountId, profile);
    }
    return result;
  }

  async function actorProfile() {
    const profile = (await profilesByAccount([actorId])).get(actorId);
    if (!profile) throw new SocialError(409, "Complete your profile before continuing.");
    return profile;
  }

  async function assertPostAccess(postId) {
    // Do not use the admin key for permission checks on the user's behalf.
    const response = await userRequest(queryPath(docPath(postsPath, postId), [select(["$id"])]));
    if ([401, 403, 404].includes(response.status)) throw new SocialError(404, "Post not found.");
    await read(response);
  }

  async function postRecord(postId, tx) {
    // Relationship expansion is explicit: an omitted relation is never an empty
    // set. This is essential when updating the pre-existing many-to-many likes.
    return read(await request(queryPath(docPath(postsPath, postId), [
      select(["$id", "creator.$id", "creator.accountId", "likes.$id"]),
    ], tx)));
  }

  async function postOwner(post) {
    let creator = post.creator;
    if (typeof creator === "string" || (isId(creator?.$id) && !isId(creator.accountId))) {
      creator = await get(docPath(usersPath, typeof creator === "string" ? creator : creator.$id), undefined, true);
    }
    return isId(creator?.accountId) ? creator.accountId : null;
  }

  async function commentRecord(commentId, tx) {
    const record = await get(docPath(commentsPath, commentId), tx, true);
    if (!record || !isId(record.postId) || !isId(record.authorId)) {
      throw new SocialError(404, "Comment not found.");
    }
    return record;
  }

  async function commentDTOs(records) {
    const profiles = await profilesByAccount(records.map((c) => c.authorId));
    return Promise.all(records.map(async (comment) => {
      let replyCount = 0;
      if (!comment.rootId) {
        const page = await list(commentsPath, [equal("rootId", comment.$id), equal("deleted", false), limit(1)]);
        replyCount = page.total;
      }
      return {
        $id: comment.$id, postId: comment.postId,
        content: comment.deleted ? "" : comment.content,
        deleted: comment.deleted === true,
        parentId: comment.parentId ?? null, rootId: comment.rootId ?? null,
        $createdAt: comment.$createdAt,
        author: publicProfile(profiles.get(comment.authorId)),
        canDelete: comment.authorId === actorId && !comment.deleted,
        replyCount,
      };
    }));
  }

  // A transaction never falls back to overwriting a relationship array outside isolation.
  // Appwrite conflicts are retried from a fresh snapshot; other errors remain failures.
  async function transaction(operation) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const tx = await read(await request("/databases/transactions", { method: "POST", data: { ttl: 60 } }));
      if (!isId(tx?.$id)) throw new Error("Invalid transaction");
      try {
        const result = await operation(tx.$id);
        await read(await request(`/databases/transactions/${tx.$id}`, { method: "PATCH", data: { commit: true } }));
        return result;
      } catch (error) {
        await request(`/databases/transactions/${tx.$id}`, { method: "PATCH", data: { rollback: true } }).catch(() => {});
        if (!(error instanceof SocialError) || error.status !== 409 || attempt === 4) throw error;
      }
    }
  }

  const notificationId = (type, recipientId, postId = null, commentId = null) =>
    stableId("notification", type, actorId, recipientId, postId, commentId);

  async function notify(type, recipientId, { postId = null, commentId = null } = {}, tx) {
    if (!isId(recipientId) || recipientId === actorId) return;
    const id = notificationId(type, recipientId, postId, commentId);
    // Repeated desired-state requests must not turn a read alert back into an unread alert.
    if (await get(docPath(notificationsPath, id), tx, true)) return;
    await create(notificationsPath, id, { recipientId, actorId, type, postId, commentId, read: false }, tx);
  }

  async function undoNotification(type, recipientId, postId, tx) {
    if (isId(recipientId) && recipientId !== actorId) {
      await remove(docPath(notificationsPath, notificationId(type, recipientId, postId)), tx);
    }
  }

  async function setFollow({ following, followingId, followsPath, documentId }) {
    return transaction(async (tx) => {
      const path = docPath(followsPath, documentId);
      const existing = await get(path, tx, true);
      if (existing && (existing.followerId !== actorId || existing.followingId !== followingId)) {
        throw new Error("Invalid follow record");
      }
      if (following) {
        if (!existing) await create(followsPath, documentId, { followerId: actorId, followingId }, tx);
        else await update(path, { followerId: actorId, followingId }, tx);
        await notify("follow", followingId, {}, tx);
      } else {
        if (existing) await remove(path, tx);
        else {
          // Touch the absent pair as well, so a concurrent follow cannot leave
          // an edge committed alongside this unfollow's notification removal.
          await create(followsPath, documentId, { followerId: actorId, followingId }, tx);
          await remove(path, tx);
        }
        await undoNotification("follow", followingId, null, tx);
      }
      const live = await get(path, undefined, true);
      if (Boolean(live) !== Boolean(existing)) throw new SocialError(409, "The data changed. Please try again.");
      return { following };
    });
  }

  function likeIds(post) {
    if (!Array.isArray(post.likes)) throw new Error("Invalid likes relationship");
    const ids = post.likes.map((value) => typeof value === "string" ? value : value?.$id);
    if (!ids.every(isId)) throw new Error("Invalid likes relationship");
    return [...new Set(ids)];
  }

  async function dispatch(body) {
    switch (body.action) {
      case "getLikes": {
        await assertPostAccess(body.postId);
        const post = await postRecord(body.postId);
        return { postId: body.postId, likes: likeIds(post) };
      }
      case "setLike": {
        await assertPostAccess(body.postId);
        const profile = await actorProfile();
        return transaction(async (tx) => {
          const path = docPath(postsPath, body.postId);
          const post = await postRecord(body.postId, tx);
          const ownerId = await postOwner(post);
          const originalLikes = likeIds(post);
          const likes = new Set(originalLikes);
          if (body.shouldLike) likes.add(profile.$id); else likes.delete(profile.$id);
          const nextLikes = [...likes];
          // Always stage the affected post, including idempotent calls, to protect the
          // notification against a concurrent opposite action on the same relation.
          await update(path, { likes: nextLikes }, tx);
          // Also close the read-to-stage window: if another writer changed likes
          // before the update was staged, transaction conflict detection alone
          // might capture that newer version while our computed union is stale.
          const liveLikes = likeIds(await postRecord(body.postId));
          if (liveLikes.length !== originalLikes.length || liveLikes.some((id) => !originalLikes.includes(id))) {
            throw new SocialError(409, "The data changed. Please try again.");
          }
          if (body.shouldLike) await notify("like", ownerId, { postId: body.postId }, tx);
          else await undoNotification("like", ownerId, body.postId, tx);
          return { postId: body.postId, likes: nextLikes };
        });
      }
      case "createComment": {
        await assertPostAccess(body.postId);
        await actorProfile();
        const id = stableId("comment", actorId, body.requestId);
        const content = body.content.trim();
        const record = await transaction(async (tx) => {
          const existing = await get(docPath(commentsPath, id), tx, true);
          if (existing) {
            if (existing.authorId !== actorId || existing.postId !== body.postId ||
                (existing.parentId ?? null) !== (body.parentId ?? null) ||
                (!existing.deleted && existing.content !== content)) {
              throw new SocialError(422, "This request ID was already used for a different comment.");
            }
            return existing;
          }
          const post = await postRecord(body.postId, tx);
          const ownerId = await postOwner(post);
          const parent = body.parentId ? await commentRecord(body.parentId, tx) : null;
          if (parent && parent.postId !== body.postId) throw new SocialError(400, "Reply to a comment on this post.");
          const data = {
            postId: body.postId, authorId: actorId, content, deleted: false,
            parentId: parent?.$id ?? null, rootId: parent ? (parent.rootId ?? parent.$id) : null,
          };
          const created = await create(commentsPath, id, data, tx);
          if (parent) await notify("reply", parent.authorId, { postId: body.postId, commentId: id }, tx);
          if (!parent || parent.authorId !== ownerId) await notify("comment", ownerId, { postId: body.postId, commentId: id }, tx);
          return created;
        });
        return { comment: (await commentDTOs([record]))[0] };
      }
      case "commentCount": {
        await assertPostAccess(body.postId);
        const page = await list(commentsPath, [equal("postId", body.postId), equal("deleted", false), limit(1)]);
        return { count: page.total };
      }
      case "getComment": {
        const record = await commentRecord(body.commentId);
        await assertPostAccess(record.postId);
        return { comment: (await commentDTOs([record]))[0] };
      }
      case "listComments": {
        await assertPostAccess(body.postId);
        if (body.rootId) {
          const root = await commentRecord(body.rootId);
          if (root.postId !== body.postId || root.rootId) throw new SocialError(400, "Invalid comment thread.");
        }
        const match = (c) => c.postId === body.postId &&
          (body.rootId ? c.rootId === body.rootId : c.parentId == null);
        if (body.cursor && !match(await commentRecord(body.cursor))) throw new SocialError(400, "Invalid comments cursor.");
        const queries = [equal("postId", body.postId),
          body.rootId ? equal("rootId", body.rootId) : { method: "isNull", attribute: "parentId" },
          order("orderAsc", "$createdAt"), order("orderAsc", "$id"), limit(pageSize)];
        if (body.cursor) queries.push({ method: "cursorAfter", values: [body.cursor] });
        const page = await list(commentsPath, queries);
        return { comments: await commentDTOs(page.documents), nextCursor: page.documents.length === pageSize ? page.documents.at(-1).$id : null };
      }
      case "deleteComment": {
        const record = await commentRecord(body.commentId);
        await assertPostAccess(record.postId);
        if (record.authorId !== actorId) throw new SocialError(403, "You can only delete your own comments.");
        if (!record.deleted) await update(docPath(commentsPath, body.commentId), { deleted: true, content: "" });
        return { commentId: body.commentId };
      }
      case "listNotifications": {
        if (body.cursor) {
          const cursor = await get(docPath(notificationsPath, body.cursor), undefined, true);
          if (!cursor || cursor.recipientId !== actorId) throw new SocialError(400, "Invalid notifications cursor.");
        }
        const queries = [equal("recipientId", actorId), order("orderDesc", "$createdAt"), order("orderDesc", "$id"), limit(pageSize)];
        if (body.cursor) queries.push({ method: "cursorAfter", values: [body.cursor] });
        const page = await list(notificationsPath, queries);
        const profiles = await profilesByAccount(page.documents.map((n) => n.actorId));
        return {
          notifications: page.documents.map((n) => ({
            $id: n.$id, actor: publicProfile(profiles.get(n.actorId)), type: n.type,
            postId: n.postId ?? null, commentId: n.commentId ?? null,
            read: n.read === true, $createdAt: n.$createdAt,
          })),
          nextCursor: page.documents.length === pageSize ? page.documents.at(-1).$id : null,
        };
      }
      case "unreadCount": {
        const page = await list(notificationsPath, [equal("recipientId", actorId), equal("read", false), limit(1)]);
        return { count: page.total };
      }
      case "markNotificationRead": {
        const path = docPath(notificationsPath, body.id);
        const record = await get(path, undefined, true);
        if (!record || record.recipientId !== actorId) throw new SocialError(404, "Notification not found.");
        if (!record.read) await update(path, { read: true });
        return { id: body.id };
      }
      case "markAllNotificationsRead": {
        // Bound this operation to alerts that existed when the user clicked the button.
        const cutoff = new Date().toISOString();
        const seen = new Set();
        while (true) {
          const page = await list(notificationsPath, [equal("recipientId", actorId), equal("read", false),
            { method: "lessThanEqual", attribute: "$createdAt", values: [cutoff] }, limit(100)]);
          if (!page.documents.length) return {};
          for (const n of page.documents) {
            if (seen.has(n.$id)) throw new Error("Notifications did not advance");
            seen.add(n.$id);
            await update(docPath(notificationsPath, n.$id), { read: true });
          }
        }
      }
      default: throw new SocialError(400, "Invalid social request.");
    }
  }
  return { dispatch, setFollow };
}
