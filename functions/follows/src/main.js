import { createHash } from "node:crypto";

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
    if (
      !body ||
      typeof body !== "object" ||
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
  } = process.env;
  const key = req.headers["x-appwrite-key"];
  if (!endpoint || !projectId || !databaseId || !usersCollectionId || !key) {
    error?.("Follows function configuration is incomplete.");
    return fail(500, "Follows is temporarily unavailable.");
  }

  const base = endpoint.replace(/\/+$/, "");
  const headers = { "X-Appwrite-Project": projectId };
  const request = (path, { method = "GET", data } = {}) =>
    fetch(`${base}${path}`, {
      method,
      redirect: "error",
      headers: {
        ...headers,
        "X-Appwrite-Key": key,
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const collections = `/databases/${encodeURIComponent(databaseId)}/collections`;
  const follows = `${collections}/follows/documents`;

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

    const documentId = pairId(followerId, followingId);
    const followPath = `${follows}/${documentId}`;
    const isSelf = followerId === followingId;
    if (body.action === "set") {
      if (isSelf) return fail(400, "You cannot follow yourself.");

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
  } catch {
    error?.("An Appwrite operation failed while processing follows.");
    return fail(500, "Follows is temporarily unavailable.");
  }
}
