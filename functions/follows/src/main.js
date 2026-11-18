import { createHash } from "node:crypto";
import { createSocialService, isSocialAction, validSocialRequest, SocialError, SocialUpstreamError } from "./social.js";

const appwriteId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;

function isId(value) {
  return typeof value === "string" && appwriteId.test(value);
}

function pairId(followerId, followingId) {
  return createHash("sha256")
    .update(JSON.stringify([followerId, followingId]))
    .digest("hex")
    .slice(0, 36);
}

function readRequest(req) {
  try {
    const body = req.bodyJson ?? JSON.parse(req.bodyText ?? req.body ?? "");
    if (!body || typeof body !== "object") return null;
    if (isSocialAction(body.action)) return validSocialRequest(body) ? body : null;
    if (body.action === "listFollowing") return body;
    if (body.action === "listConnections") {
      return (
        isId(body.targetId) &&
        ["followers", "following"].includes(body.direction) &&
        (body.cursor === undefined || isId(body.cursor))
      ) ? body : null;
    }

    if (
      !isId(body.targetId) ||
      (body.action !== "get" && body.action !== "set") ||
      (body.action === "set" && typeof body.following !== "boolean") ||
      (body.action === "get" &&
        body.includeCounts !== undefined &&
        typeof body.includeCounts !== "boolean")
    ) {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

async function countFollows(request, path, field, accountId) {
  const queries = new URLSearchParams({
    "queries[0]": JSON.stringify({
      method: "equal",
      attribute: field,
      values: [accountId],
    }),
    "queries[1]": JSON.stringify({ method: "limit", values: [1] }),
  });
  const response = await request(`${path}?${queries}`);
  if (!response.ok) throw new Error("Could not count follows");
  const { total } = await response.json();
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("Invalid follow count");
  }
  return total;
}

async function listFollowing(request, path, accountId) {
  const pageSize = 100;
  const accountIds = new Set();
  const usedCursors = new Set();
  let cursor;

  while (true) {
    const queries = [
      { method: "equal", attribute: "followerId", values: [accountId] },
      { method: "limit", values: [pageSize] },
      { method: "select", values: ["$id", "followingId"] },
    ];
    if (cursor) queries.push({ method: "cursorAfter", values: [cursor] });

    const params = new URLSearchParams(
      queries.map((query, index) => [`queries[${index}]`, JSON.stringify(query)])
    );
    const response = await request(`${path}?${params}`);
    if (!response.ok) throw new Error("Could not list follows");

    const { documents } = await response.json();
    if (!Array.isArray(documents)) throw new Error("Invalid follows page");

    for (const record of documents) {
      if (!isId(record?.followingId)) throw new Error("Invalid follow account ID");
      accountIds.add(record.followingId);
    }

    if (documents.length < pageSize) return [...accountIds];

    cursor = documents.at(-1)?.$id;
    if (!isId(cursor) || usedCursors.has(cursor)) {
      throw new Error("Invalid follows cursor");
    }
    usedCursors.add(cursor);
  }
}

async function listConnections(request, followsPath, usersPath, accountId, direction, cursor) {
  const pageSize = 20;
  const filterField = direction === "followers" ? "followingId" : "followerId";
  const connectionField = direction === "followers" ? "followerId" : "followingId";
  const queries = [
    { method: "equal", attribute: filterField, values: [accountId] },
    { method: "limit", values: [pageSize] },
    { method: "select", values: ["$id", connectionField] },
    { method: "orderAsc", attribute: "$id" },
  ];
  if (cursor) queries.push({ method: "cursorAfter", values: [cursor] });

  const parameters = new URLSearchParams(
    queries.map((query, index) => [`queries[${index}]`, JSON.stringify(query)])
  );
  const response = await request(`${followsPath}?${parameters}`);
  if (!response.ok) throw new Error("Could not list connections");
  const { documents: edges } = await response.json();
  if (!Array.isArray(edges)) throw new Error("Invalid connections page");

  const accountIds = [];
  for (const edge of edges) {
    if (!isId(edge?.$id) || !isId(edge[connectionField])) {
      throw new Error("Invalid connection");
    }
    accountIds.push(edge[connectionField]);
  }
  const nextCursor = edges.length === pageSize ? edges.at(-1).$id : null;
  if (nextCursor !== null && nextCursor === cursor) {
    throw new Error("Invalid connections cursor");
  }
  if (accountIds.length === 0) return { profiles: [], nextCursor: null };

  const profileQueries = [
    { method: "equal", attribute: "accountId", values: [...new Set(accountIds)] },
    { method: "limit", values: [pageSize] },
    {
      method: "select",
      values: ["$id", "accountId", "name", "username", "imageUrl"],
    },
  ];
  const profileParameters = new URLSearchParams(
    profileQueries.map((query, index) => [`queries[${index}]`, JSON.stringify(query)])
  );
  const profileResponse = await request(`${usersPath}?${profileParameters}`);
  if (!profileResponse.ok) throw new Error("Could not load connection profiles");
  const { documents } = await profileResponse.json();
  if (!Array.isArray(documents)) throw new Error("Invalid connection profiles");

  const profilesByAccount = new Map();
  for (const profile of documents) {
    if (!isId(profile?.$id) || !accountIds.includes(profile.accountId)) continue;
    profilesByAccount.set(profile.accountId, {
      $id: profile.$id,
      name: typeof profile.name === "string" ? profile.name : "ZeroNet member",
      username: typeof profile.username === "string" ? profile.username : "",
      imageUrl: typeof profile.imageUrl === "string" ? profile.imageUrl : "",
    });
  }
  const profiles = [...new Set(accountIds)]
    .map((id) => profilesByAccount.get(id))
    .filter(Boolean);
  return { profiles, nextCursor };
}

async function getFollow(request, path, followerId, followingId) {
  const response = await request(path);
  const record = await response.json();
  if (response.status === 404 && record.type === "document_not_found") {
    return false;
  }
  if (
    !response.ok ||
    record.followerId !== followerId ||
    record.followingId !== followingId
  ) {
    throw new Error("Could not read the follow record");
  }
  return true;
}

export default async function handler({ req, res, error }) {
  const fail = (status, message) => res.json({ error: message }, status);

  if (req.method?.toUpperCase() !== "POST") {
    return fail(405, "Use POST for this request.");
  }
  const jwt = req.headers["x-appwrite-user-jwt"];
  if (typeof jwt !== "string" || !jwt) {
    return fail(401, "Sign in to use follows.");
  }
  const body = readRequest(req);
  if (!body) return fail(400, "Invalid follow request.");

  const {
    APPWRITE_FUNCTION_API_ENDPOINT: endpoint,
    APPWRITE_FUNCTION_PROJECT_ID: projectId,
    FOLLOWS_DATABASE_ID: databaseId,
    FOLLOWS_USERS_COLLECTION_ID: usersCollectionId,
    SOCIAL_POSTS_COLLECTION_ID: postsCollectionId,
  } = process.env;
  const key = req.headers["x-appwrite-key"];
  if (!endpoint || !projectId || !databaseId || !usersCollectionId || !key) {
    error?.("Follows function configuration is incomplete.");
    return fail(500, "Follows is temporarily unavailable.");
  }

  const base = endpoint.replace(/\/+$/, "");
  const headers = { "X-Appwrite-Project": projectId };
  const request = async (path, { method = "GET", data } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      redirect: "error",
      headers: {
        ...headers,
        "X-Appwrite-Key": key,
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const resource = path.startsWith("/databases/transactions") ? "transactions"
      : path.includes("/comments/documents") ? "comments"
      : path.includes("/notifications/documents") ? "notifications"
      : path.includes("/follows/documents") ? "follows" : "documents";
    response.socialOperation = `${method} ${resource}`;
    return response;
  };
  const collections = `/databases/${encodeURIComponent(databaseId)}/collections`;
  const follows = `${collections}/follows/documents`;
  const userRequest = (path) => fetch(`${base}${path}`, {
    redirect: "error", headers: { ...headers, "X-Appwrite-JWT": jwt },
  });

  try {
    const session = await fetch(`${base}/account`, {
      redirect: "error",
      headers: { ...headers, "X-Appwrite-JWT": jwt },
    });
    if (session.status === 401 || session.status === 403) {
      return fail(401, "Sign in to use follows.");
    }
    if (!session.ok) throw new Error("Could not verify the session");
    const { $id: followerId } = await session.json();
    if (!isId(followerId)) throw new Error("Invalid session response");

    const social = postsCollectionId ? createSocialService({
      request, userRequest, collections,
      usersPath: `${collections}/${encodeURIComponent(usersCollectionId)}/documents`,
      postsCollectionId, actorId: followerId,
    }) : null;
    if (isSocialAction(body.action)) {
      if (!social) throw new Error("Social configuration is incomplete");
      return res.json(await social.dispatch(body));
    }

    if (body.action === "listFollowing") {
      const accountIds = await listFollowing(request, follows, followerId);
      return res.json({ accountIds });
    }

    const targetResponse = await request(
      `${collections}/${encodeURIComponent(usersCollectionId)}/documents/${encodeURIComponent(body.targetId)}`
    );
    const target = await targetResponse.json();
    if (targetResponse.status === 404 && target.type === "document_not_found") {
      return fail(404, "Profile not found.");
    }
    if (!targetResponse.ok) throw new Error("Could not read the target profile");
    const followingId = target.accountId;
    if (!isId(followingId)) return fail(404, "Profile not found.");

    if (body.action === "listConnections") {
      const connections = await listConnections(
        request,
        follows,
        `${collections}/${encodeURIComponent(usersCollectionId)}/documents`,
        followingId,
        body.direction,
        body.cursor
      );
      return res.json(connections);
    }

    const documentId = pairId(followerId, followingId);
    const followPath = `${follows}/${documentId}`;
    const isSelf = followerId === followingId;
    if (body.action === "set") {
      if (isSelf) return fail(400, "You cannot follow yourself.");
      if (social) return res.json(await social.setFollow({
        following: body.following, followingId, followsPath: follows, documentId,
      }));

      if (body.following) {
        const created = await request(follows, {
          method: "POST",
          data: {
            documentId,
            data: { followerId, followingId },
            permissions: [],
          },
        });
        if (!created.ok) {
          if (created.status !== 409) throw new Error("Could not create a follow");
          if (!(await getFollow(request, followPath, followerId, followingId))) {
            throw new Error("Follow creation conflicted without a matching record");
          }
        }
      } else {
        const deleted = await request(followPath, { method: "DELETE" });
        if (!deleted.ok) {
          const response = await deleted.json();
          if (deleted.status !== 404 || response.type !== "document_not_found") {
            throw new Error("Could not delete a follow");
          }
        }
      }
      return res.json({ following: body.following });
    }

    const isFollowing = isSelf
      ? Promise.resolve(false)
      : getFollow(request, followPath, followerId, followingId);
    if (!body.includeCounts) {
      return res.json({ following: await isFollowing });
    }

    const [following, followers, followingCount] = await Promise.all([
      isFollowing,
      countFollows(request, follows, "followingId", followingId),
      countFollows(request, follows, "followerId", followingId),
    ]);
    return res.json({ following, counts: { followers, following: followingCount } });
  } catch (cause) {
    if (cause instanceof SocialError) return fail(cause.status, cause.message);
    if (cause instanceof SocialUpstreamError) {
      error?.(`Appwrite social failure: operation=${cause.operation}; status=${cause.status}; type=${cause.type}.`);
    }
    error?.("An Appwrite operation failed while processing follows.");
    return fail(500, "Follows is temporarily unavailable.");
  }
}
