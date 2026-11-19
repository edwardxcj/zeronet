import { Query } from "appwrite";

import { appwriteConfig, databases } from "./config";
import { normalizeImageUrls } from "./imageUrls";
import { relationshipDocuments, relationshipId } from "./relationships";

export type PostCollection = "saved" | "liked";

export function collectedPostIds(
  profile: unknown,
  collection: PostCollection
): string[] {
  const relations = profile && typeof profile === "object"
    ? profile as { save?: unknown; liked?: unknown } : undefined;
  const values = collection === "saved"
    ? relationshipDocuments(relations?.save).map((record) => record.post).reverse()
    : Array.isArray(relations?.liked) ? relations.liked : [];
  return [...new Set(values.map(relationshipId).filter((id): id is string => !!id))];
}

export async function getCollectedPosts(postIds: readonly string[]) {
  const ids = [...new Set(postIds.filter((id) => typeof id === "string" && id.length > 0))];
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += 25) batches.push(ids.slice(offset, offset + 25));

  // Reading posts directly keeps their creator one relationship hop away.
  // A user -> save -> post -> creator expansion can otherwise be truncated.
  const pages = await Promise.all(batches.map((batch) => databases.listDocuments(
    appwriteConfig.databaseId,
    appwriteConfig.postCollectionId,
    [Query.equal("$id", batch), Query.limit(batch.length)]
  )));
  const posts = new Map(pages.flatMap((page) => page.documents).map((post) => [post.$id, post]));
  return normalizeImageUrls(ids.flatMap((id) => {
    const post = posts.get(id);
    return post ? [post] : [];
  }), appwriteConfig.url);
}
