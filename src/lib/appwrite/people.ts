import { Query } from "appwrite";

import { appwriteConfig, databases } from "./config";
import { normalizeImageUrls } from "./imageUrls";

const batchSize = 50;

export async function getPeoplePage(cursor: string | null) {
  const queries = [
    Query.select(["$id", "name", "username", "imageUrl"]),
    Query.orderAsc("$id"),
    Query.limit(batchSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));

  const page = await databases.listDocuments(
    appwriteConfig.databaseId,
    appwriteConfig.userCollectionId,
    queries
  );
  const lastId = page.documents[page.documents.length - 1]?.$id;
  if (lastId === cursor) {
    throw new Error("The people page did not advance.");
  }

  return {
    documents: normalizeImageUrls(page.documents, appwriteConfig.url),
    nextCursor: page.documents.length === batchSize ? lastId : undefined,
  };
}
