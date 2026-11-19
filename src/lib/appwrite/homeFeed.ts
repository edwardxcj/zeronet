import { Query } from "appwrite";

import { appwriteConfig, databases } from "./config";
import { normalizeImageUrls } from "./imageUrls";

const pageSize = 20;

export async function getHomeFeedPage(cursor: string | null) {
  const queries = [
    Query.orderDesc("$createdAt"),
    Query.orderDesc("$id"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));

  const page = await databases.listDocuments(
    appwriteConfig.databaseId,
    appwriteConfig.postCollectionId,
    queries
  );
  const lastId = page.documents[page.documents.length - 1]?.$id;
  if (lastId === cursor) throw new Error("The home feed page did not advance.");

  return {
    documents: normalizeImageUrls(page.documents, appwriteConfig.url),
    nextCursor: page.documents.length === pageSize ? lastId : undefined,
  };
}
