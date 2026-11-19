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

function connectionField(direction) {
  return direction === "followers" ? "followerId" : "followingId";
}

async function readFollowPage(request, followsPath, accountId, direction, cursor, pageSize) {
  const filterField = direction === "followers" ? "followingId" : "followerId";
  const queries = [
    { method: "equal", attribute: filterField, values: [accountId] },
    { method: "limit", values: [pageSize] },
    { method: "select", values: ["$id", connectionField(direction)] },
    { method: "orderAsc", attribute: "$id" },
  ];
  if (cursor) queries.push({ method: "cursorAfter", values: [cursor] });

  const parameters = new URLSearchParams(
    queries.map((query, index) => [`queries[${index}]`, JSON.stringify(query)])
  );
  const response = await request(`${followsPath}?${parameters}`);
  if (!response.ok) throw new Error("Could not list connections");
  const { documents: edges } = await response.json();
  if (!Array.isArray(edges) || edges.length > pageSize) throw new Error("Invalid connections page");
  const edgeIds = new Set();
  for (const edge of edges) {
    if (!isId(edge?.$id) || edge.$id === cursor || edgeIds.has(edge.$id)) {
      throw new Error("Invalid connections cursor");
    }
    edgeIds.add(edge.$id);
  }
  const nextCursor = edges.length === pageSize ? edges.at(-1).$id : null;
  return { edges, nextCursor };
}

function counterpartIds(edges, accountId, direction) {
  return [...new Set(edges.map((edge) => edge[connectionField(direction)])
    .filter((id) => isId(id) && id !== accountId))];
}

async function readConnectionAccounts(request, followsPath, accountId, direction) {
  const accountIds = new Set();
  const edgeIds = new Set();
  let cursor;
  while (true) {
    const page = await readFollowPage(request, followsPath, accountId, direction, cursor, 100);
    for (const edge of page.edges) {
      if (edgeIds.has(edge.$id)) throw new Error("Invalid connections cursor");
      edgeIds.add(edge.$id);
    }
    counterpartIds(page.edges, accountId, direction).forEach((id) => accountIds.add(id));
    if (!page.nextCursor) return [...accountIds];
    cursor = page.nextCursor;
  }
}

async function readConnectionProfiles(request, usersPath, accountIds) {
  const profilesByAccount = new Map();
  // Batch by account, and paginate profiles too so duplicate legacy profiles do
  // not hide a different real account behind the response's document limit.
  for (let offset = 0; offset < accountIds.length; offset += 25) {
    const batch = accountIds.slice(offset, offset + 25);
    const seenProfiles = new Set();
    let cursor;
    while (true) {
      const queries = [
        { method: "equal", attribute: "accountId", values: batch },
        { method: "limit", values: [100] },
        { method: "select", values: ["$id", "accountId", "name", "username", "imageUrl"] },
        { method: "orderAsc", attribute: "$id" },
      ];
      if (cursor) queries.push({ method: "cursorAfter", values: [cursor] });
      const parameters = new URLSearchParams(
        queries.map((query, index) => [`queries[${index}]`, JSON.stringify(query)])
      );
      const response = await request(`${usersPath}?${parameters}`);
      if (!response.ok) throw new Error("Could not load connection profiles");
      const { documents } = await response.json();
      if (!Array.isArray(documents) || documents.length > 100) throw new Error("Invalid connection profiles");
      for (const profile of documents) {
        if (!isId(profile?.$id) || !batch.includes(profile.accountId) || seenProfiles.has(profile.$id)) {
          throw new Error("Invalid connection profiles");
        }
        seenProfiles.add(profile.$id);
        if (!profilesByAccount.has(profile.accountId)) {
          profilesByAccount.set(profile.accountId, {
            $id: profile.$id,
            name: typeof profile.name === "string" ? profile.name : "ZeroNet member",
            username: typeof profile.username === "string" ? profile.username : "",
            imageUrl: typeof profile.imageUrl === "string" ? profile.imageUrl : "",
          });
        }
      }
      if (documents.length < 100 || batch.every((id) => profilesByAccount.has(id))) break;
      cursor = documents.at(-1).$id;
    }
  }
  return profilesByAccount;
}

async function validConnectionAccounts(request, followsPath, usersPath, accountId, direction) {
  const accountIds = await readConnectionAccounts(request, followsPath, accountId, direction);
  const profiles = await readConnectionProfiles(request, usersPath, accountIds);
  return accountIds.filter((id) => profiles.has(id));
}

async function listConnections(request, followsPath, usersPath, accountId, direction, cursor) {
  const { edges, nextCursor } = await readFollowPage(request, followsPath, accountId, direction, cursor, 20);
  const accountIds = counterpartIds(edges, accountId, direction);
  const profilesByAccount = await readConnectionProfiles(request, usersPath, accountIds);
  const profiles = accountIds.map((id) => profilesByAccount.get(id)).filter(Boolean);
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
  const users = `${collections}/${encodeURIComponent(usersCollectionId)}/documents`;
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
      const accountIds = await validConnectionAccounts(request, follows, users, followerId, "following");
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
      validConnectionAccounts(request, follows, users, followingId, "followers"),
      validConnectionAccounts(request, follows, users, followingId, "following"),
    ]);
    return res.json({ following, counts: { followers: followers.length, following: followingCount.length } });
  } catch (cause) {
    if (cause instanceof SocialError) return fail(cause.status, cause.message);
    if (cause instanceof SocialUpstreamError) {
      error?.(`Appwrite social failure: operation=${cause.operation}; status=${cause.status}; type=${cause.type}.`);
    }
    error?.("An Appwrite operation failed while processing follows.");
    return fail(500, "Follows is temporarily unavailable.");
  }
}
