import { AppwriteException, Functions } from "appwrite";
import { z } from "zod";

import { appwriteConfig, client } from "./config";
import { normalizeImageUrls } from "./imageUrls";

const functions = new Functions(client);
const publicProfile = z.object({
  $id: z.string(),
  name: z.string(),
  username: z.string(),
  imageUrl: z.string(),
});

const commentSchema = z.object({
  $id: z.string(),
  postId: z.string(),
  content: z.string(),
  deleted: z.boolean(),
  parentId: z.string().nullable(),
  rootId: z.string().nullable(),
  $createdAt: z.string(),
  author: publicProfile.nullable(),
  canDelete: z.boolean(),
  replyCount: z.number().int().nonnegative(),
});

export type Comment = z.infer<typeof commentSchema>;

const notificationSchema = z.object({
  $id: z.string(),
  actor: publicProfile.nullable(),
  type: z.enum(["follow", "like", "comment", "reply"]),
  postId: z.string().nullable(),
  commentId: z.string().nullable(),
  read: z.boolean(),
  $createdAt: z.string(),
});

export type Notification = z.infer<typeof notificationSchema>;

type SocialRequest =
  | { action: "commentCount"; postId: string }
  | { action: "getComment"; commentId: string }
  | { action: "listComments"; postId: string; rootId?: string; cursor?: string }
  | { action: "createComment"; postId: string; content: string; parentId?: string; requestId: string }
  | { action: "deleteComment"; commentId: string }
  | { action: "getLikes"; postId: string }
  | { action: "setLike"; postId: string; shouldLike: boolean }
  | { action: "listNotifications"; cursor?: string }
  | { action: "unreadCount" }
  | { action: "markNotificationRead"; id: string }
  | { action: "markAllNotificationsRead" };

async function executeSocial(request: SocialRequest): Promise<unknown> {
  const result = await functions.createExecution(
    "zeronet-follows",
    JSON.stringify(request),
    false,
    "/",
    "POST",
    { "content-type": "application/json" }
  );
  if (
    result.status !== "completed" ||
    result.responseStatusCode < 200 ||
    result.responseStatusCode >= 300
  ) {
    let message = "The request could not be completed.";
    if (result.responseStatusCode === 400) {
      try {
        const response = JSON.parse(result.responseBody);
        if (typeof response.error === "string" && response.error.length <= 200) {
          message = response.error;
        }
      } catch {
        // A function may return a non-JSON error response.
      }
    }
    throw new AppwriteException(message, result.responseStatusCode);
  }
  return JSON.parse(result.responseBody);
}

const commentsPage = z.object({
  comments: z.array(commentSchema),
  nextCursor: z.string().nullable(),
});

export async function getCommentCount(postId: string) {
  return z.object({ count: z.number().int().nonnegative() }).parse(
    await executeSocial({ action: "commentCount", postId })
  );
}

export async function listComments(postId: string, rootId?: string, cursor?: string) {
  const response = commentsPage.parse(
    await executeSocial({ action: "listComments", postId, rootId, cursor })
  );
  return normalizeImageUrls(response, appwriteConfig.url);
}

export async function getComment(commentId: string) {
  const { comment } = z.object({ comment: commentSchema }).parse(
    await executeSocial({ action: "getComment", commentId })
  );
  return normalizeImageUrls(comment, appwriteConfig.url);
}

export async function createComment(input: {
  postId: string;
  content: string;
  parentId?: string;
  requestId: string;
}) {
  const { comment } = z.object({ comment: commentSchema }).parse(
    await executeSocial({ action: "createComment", ...input })
  );
  return normalizeImageUrls(comment, appwriteConfig.url);
}

export async function deleteComment(commentId: string) {
  return z.object({ commentId: z.string() }).parse(
    await executeSocial({ action: "deleteComment", commentId })
  );
}

const likesResponse = z.object({ postId: z.string(), likes: z.array(z.string()) });

export async function getPostLikes(postId: string) {
  return likesResponse.parse(await executeSocial({ action: "getLikes", postId }));
}

export async function setPostLike(postId: string, shouldLike: boolean) {
  return likesResponse.parse(await executeSocial({ action: "setLike", postId, shouldLike }));
}

const notificationsPage = z.object({
  notifications: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
});

export async function listNotifications(cursor?: string) {
  const response = notificationsPage.parse(
    await executeSocial({ action: "listNotifications", cursor })
  );
  return normalizeImageUrls(response, appwriteConfig.url);
}

export async function unreadNotificationCount() {
  return z.object({ count: z.number().int().nonnegative() }).parse(
    await executeSocial({ action: "unreadCount" })
  );
}

export async function markNotificationRead(id: string) {
  return z.object({ id: z.string() }).parse(
    await executeSocial({ action: "markNotificationRead", id })
  );
}

export async function markAllNotificationsRead() {
  await executeSocial({ action: "markAllNotificationsRead" });
}
