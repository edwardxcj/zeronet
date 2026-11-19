import { ID, Query } from "appwrite";

import { appwriteConfig, account, databases, storage, avatars } from "./config";
import { IUpdatePost, INewPost, INewUser, IUpdateUser, PostSaveProgress } from "@/types";
import { normalizeImageUrls } from "./imageUrls";
import { setPostLike } from "./social";
import { SignupProfileError } from "../authErrors";

function withFileViewUrls<T>(value: T): T {
  return normalizeImageUrls(value, appwriteConfig.url);
}

// ============================================================
// AUTH
// ============================================================

// ============================== SIGN UP
export async function createUserAccount(user: INewUser) {
  const newAccount = await account.create(
    ID.unique(),
    user.email,
    user.password,
    user.name
  );

  try {
    await account.createEmailSession(user.email, user.password);
    const avatarUrl = avatars.getInitials(user.name);
    return await saveUserToDB({
      accountId: newAccount.$id,
      name: newAccount.name,
      email: newAccount.email,
      username: user.username,
      imageUrl: avatarUrl,
    });
  } catch {
    throw new SignupProfileError(newAccount.$id);
  }
}

// ============================== SAVE USER TO DB
export async function saveUserToDB(user: {
  accountId: string;
  email: string;
  name: string;
  imageUrl: URL;
  username?: string;
}) {
  const newUser = await databases.createDocument(
    appwriteConfig.databaseId,
    appwriteConfig.userCollectionId,
    user.accountId,
    user
  );

  return withFileViewUrls(newUser);
}

// A created account can finish its profile after an interrupted sign-up.
export async function completeSignupProfile(
  user: Pick<INewUser, "name" | "username">,
  expectedAccountId?: string
) {
  const currentAccount = await account.get();
  if (expectedAccountId && currentAccount.$id !== expectedAccountId) {
    throw new Error("The signed-in account changed.");
  }
  const existing = await databases.listDocuments(
    appwriteConfig.databaseId,
    appwriteConfig.userCollectionId,
    [Query.equal("accountId", currentAccount.$id), Query.limit(1)]
  );
  if (existing.documents[0]) return withFileViewUrls(existing.documents[0]);

  try {
    return await saveUserToDB({
      accountId: currentAccount.$id,
      name: user.name,
      email: currentAccount.email,
      username: user.username,
      imageUrl: avatars.getInitials(user.name),
    });
  } catch (error) {
    // A retry may follow a successful write whose response did not arrive.
    if (error && typeof error === "object" && "code" in error && error.code === 409) {
      const saved = await databases.getDocument(
        appwriteConfig.databaseId,
        appwriteConfig.userCollectionId,
        currentAccount.$id
      );
      if (saved.accountId === currentAccount.$id) return withFileViewUrls(saved);
    }
    throw error;
  }
}

// ============================== SIGN IN
export async function signInAccount(user: { email: string; password: string }) {
  try {
    return await account.createEmailSession(user.email, user.password);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "type" in error &&
      error.type === "user_session_already_exists"
    ) {
      const currentAccount = await account.get();
      if (currentAccount.email.toLowerCase() === user.email.toLowerCase()) {
        return account.getSession("current");
      }
    }
    throw error;
  }
}

export async function requestPasswordRecovery(email: string) {
  try {
    await account.createRecovery(
      email,
      new URL("/reset-password", window.location.origin).toString()
    );
  } catch (error) {
    if (error && typeof error === "object" && "type" in error && error.type === "user_not_found") {
      return;
    }
    throw error;
  }
}

export async function confirmPasswordRecovery(
  userId: string,
  secret: string,
  password: string,
  passwordAgain: string
) {
  return account.updateRecovery(userId, secret, password, passwordAgain);
}

// ============================== GET ACCOUNT
export async function getAccount() {
  return account.get();
}

// ============================== GET USER
export async function getCurrentUser() {
  try {
    const currentAccount = await getAccount();

    if (!currentAccount) throw Error;

    const currentUser = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.userCollectionId,
      [Query.equal("accountId", currentAccount.$id)]
    );

    if (!currentUser) throw Error;

    return withFileViewUrls(currentUser.documents[0] ?? null);
  } catch {
    return null;
  }
}

// ============================== SIGN OUT
export async function signOutAccount() {
  try {
    const session = await account.deleteSession("current");

    return session;
  } catch (error) {
    console.log(error);
  }
}

// ============================================================
// POSTS
// ============================================================

// ============================== CREATE POST
export async function createPost(post: INewPost) {
  try {
    // Upload file to appwrite storage
    const uploadedFile = await uploadFile(post.file[0], post.onProgress);

    if (!uploadedFile) throw Error;

    // Get file url
    const fileUrl = getFileView(uploadedFile.$id);
    if (!fileUrl) {
      await deleteFile(uploadedFile.$id);
      throw Error;
    }

    // Convert tags into array
    const tags = post.tags?.replace(/ /g, "").split(",") || [];

    post.onProgress?.({ phase: "saving" });
    // Create post
    const newPost = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.postCollectionId,
      ID.unique(),
      {
        creator: post.userId,
        caption: post.caption,
        imageUrl: fileUrl,
        imageId: uploadedFile.$id,
        location: post.location,
        tags: tags,
      }
    );

    if (!newPost) {
      await deleteFile(uploadedFile.$id);
      throw Error;
    }

    return withFileViewUrls(newPost);
  } catch (error) {
    console.log(error);
    throw error;
  }
}

// ============================== UPLOAD FILE
export async function uploadFile(file: File, onProgress?: (progress: PostSaveProgress) => void) {
  try {
    onProgress?.({ phase: "uploading" });
    const uploadedFile = await storage.createFile(
      appwriteConfig.storageId,
      ID.unique(),
      file,
      undefined,
      (progress) => onProgress?.({
        phase: "uploading",
        percent: Math.max(0, Math.min(100, progress.progress)),
      })
    );

    onProgress?.({ phase: "uploading", percent: 100 });
    return uploadedFile;
  } catch (error) {
    console.log(error);
    throw error;
  }
}

// ============================== GET FILE URL
export function getFileView(fileId: string) {
  try {
    const fileUrl = storage.getFileView(appwriteConfig.storageId, fileId);

    if (!fileUrl) throw Error;

    return fileUrl;
  } catch (error) {
    console.log(error);
  }
}

// ============================== DELETE FILE
export async function deleteFile(fileId: string) {
  try {
    await storage.deleteFile(appwriteConfig.storageId, fileId);

    return { status: "ok" };
  } catch (error) {
    console.log(error);
  }
}

// ============================== GET POSTS
export async function searchPosts(searchTerm: string) {
  const posts = await databases.listDocuments(
    appwriteConfig.databaseId,
    appwriteConfig.postCollectionId,
    [Query.search("caption", searchTerm)]
  );
  return withFileViewUrls(posts);
}

export async function getInfinitePosts({ pageParam }: { pageParam: string | null }) {
  const queries = [Query.orderDesc("$updatedAt"), Query.limit(10)];
  if (pageParam) {
    queries.push(Query.cursorAfter(pageParam));
  }

  const posts = await databases.listDocuments(
    appwriteConfig.databaseId,
    appwriteConfig.postCollectionId,
    queries
  );
  return withFileViewUrls(posts);
}

// ============================== GET POST BY ID
export async function getPostById(postId?: string) {
  if (!postId) throw new Error("A post ID is required.");
  const post = await databases.getDocument(
    appwriteConfig.databaseId,
    appwriteConfig.postCollectionId,
    postId
  );
  return withFileViewUrls(post);
}

// ============================== UPDATE POST
export async function updatePost(post: IUpdatePost) {
  const hasFileToUpdate = post.file.length > 0;

  try {
    let image = {
      imageUrl: post.imageUrl,
      imageId: post.imageId,
    };

    if (hasFileToUpdate) {
      // Upload new file to appwrite storage
      const uploadedFile = await uploadFile(post.file[0], post.onProgress);
      if (!uploadedFile) throw Error;

      // Get new file url
      const fileUrl = getFileView(uploadedFile.$id);
      if (!fileUrl) {
        await deleteFile(uploadedFile.$id);
        throw Error;
      }

      image = { ...image, imageUrl: fileUrl, imageId: uploadedFile.$id };
    }

    // Convert tags into array
    const tags = post.tags?.replace(/ /g, "").split(",") || [];

    post.onProgress?.({ phase: "saving" });
    //  Update post
    const updatedPost = await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.postCollectionId,
      post.postId,
      {
        caption: post.caption,
        imageUrl: image.imageUrl,
        imageId: image.imageId,
        location: post.location,
        tags: tags,
      }
    );

    // Failed to update
    if (!updatedPost) {
      // Delete new file that has been recently uploaded
      if (hasFileToUpdate) {
        await deleteFile(image.imageId);
      }

      // If no new file uploaded, just throw error
      throw Error;
    }

    // Safely delete old file after successful update
    if (hasFileToUpdate) {
      await deleteFile(post.imageId);
    }

    return withFileViewUrls(updatedPost);
  } catch (error) {
    console.log(error);
    throw error;
  }
}

// ============================== DELETE POST
export async function deletePost(postId: string, imageId?: string) {
  await databases.deleteDocument(
    appwriteConfig.databaseId,
    appwriteConfig.postCollectionId,
    postId
  );
  if (imageId) await deleteFile(imageId);
}

// ============================== LIKE / UNLIKE POST
export async function likePost(postId: string, _userId: string, shouldLike: boolean) {
  const response = await setPostLike(postId, shouldLike);
  return { $id: response.postId, likes: response.likes };
}

// ============================== SAVE POST
export async function savePost(userId: string, postId: string) {
  const record = await databases.createDocument(
    appwriteConfig.databaseId,
    appwriteConfig.savesCollectionId,
    ID.unique(),
    { user: userId, post: postId }
  );
  return withFileViewUrls(record);
}
// ============================== DELETE SAVED POST
export async function deleteSavedPost(savedRecordId: string) {
  await databases.deleteDocument(
    appwriteConfig.databaseId,
    appwriteConfig.savesCollectionId,
    savedRecordId
  );
}

// ============================== GET USER'S POST
export async function getUserPosts(userId?: string) {
  if (!userId) throw new Error("A creator ID is required.");
  const posts = await databases.listDocuments(
    appwriteConfig.databaseId,
    appwriteConfig.postCollectionId,
    [Query.equal("creator", userId), Query.orderDesc("$createdAt")]
  );
  return withFileViewUrls(posts);
}

const followingBatchSize = 25;
const followingPageSize = 10;

function followingBatches<T>(values: readonly T[]): T[][] {
  const batches: T[][] = [];
  for (let offset = 0; offset < values.length; offset += followingBatchSize) {
    batches.push(values.slice(offset, offset + followingBatchSize));
  }
  return batches;
}

export async function getFollowingCreatorIds(accountIds: readonly string[]) {
  const groups = await Promise.all(followingBatches(accountIds).map(async (batch) => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const queries = [
        Query.equal("accountId", batch),
        Query.select(["$id"]),
        Query.limit(100),
      ];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const { documents } = await databases.listDocuments(
        appwriteConfig.databaseId,
        appwriteConfig.userCollectionId,
        queries
      );
      ids.push(...documents.map(({ $id }) => $id));
      cursor = documents.length === 100 ? documents.at(-1)?.$id : undefined;
    } while (cursor);
    return ids;
  }));
  return [...new Set(groups.flat())].sort();
}

type FollowingCursor = string | null | false;

export async function getFollowingPosts(
  creatorIds: readonly string[],
  cursors: FollowingCursor[] | null
) {
  const batches = followingBatches(creatorIds);
  const nextCursors = batches.map((_, index) => cursors?.[index] ?? null);
  const pages = await Promise.all(batches.map(async (ids, index) => {
    const cursor = nextCursors[index];
    if (cursor === false) return [];
    const queries = [
      Query.equal("creator", ids),
      Query.orderDesc("$createdAt"),
      Query.orderDesc("$id"),
      Query.limit(followingPageSize),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const { documents } = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.postCollectionId,
      queries
    );
    return documents;
  }));

  const ranked = pages.flatMap((posts, index) => posts.map((post) => ({ post, index })));
  ranked.sort((left, right) => {
    if (left.post.$createdAt !== right.post.$createdAt) {
      return left.post.$createdAt > right.post.$createdAt ? -1 : 1;
    }
    if (left.post.$id === right.post.$id) return 0;
    return left.post.$id > right.post.$id ? -1 : 1;
  });
  const visible = ranked.slice(0, followingPageSize);
  const consumed = batches.map(() => 0);
  for (const { post, index } of visible) {
    nextCursors[index] = post.$id;
    consumed[index]++;
  }
  pages.forEach((posts, index) => {
    if (posts.length < followingPageSize && consumed[index] === posts.length) {
      nextCursors[index] = false;
    }
  });

  return {
    documents: withFileViewUrls(visible.map(({ post }) => post)),
    nextCursors: nextCursors.some((cursor) => cursor !== false) ? nextCursors : undefined,
  };
}

// ============================== GET POPULAR POSTS (BY HIGHEST LIKE COUNT)
export async function getRecentPosts() {
  try {
    const posts = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.postCollectionId,
      [Query.orderDesc("$createdAt"), Query.limit(20)]
    );

    if (!posts) throw Error;

    return withFileViewUrls(posts);
  } catch (error) {
    console.log(error);
  }
}

// ============================================================
// USER
// ============================================================

// ============================== GET USERS
export async function getUsers(limit?: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queries: any[] = [Query.orderDesc("$createdAt")];

  if (limit) {
    queries.push(Query.limit(limit));
  }

  try {
    const users = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.userCollectionId,
      queries
    );

    if (!users) throw Error;

    return withFileViewUrls(users);
  } catch (error) {
    console.log(error);
  }
}

// ============================== GET USER BY ID
export async function getUserById(userId: string) {
  const user = await databases.getDocument(
    appwriteConfig.databaseId,
    appwriteConfig.userCollectionId,
    userId
  );
  return withFileViewUrls(user);
}

// ============================== UPDATE USER
export async function updateUser(user: IUpdateUser) {
  const hasFileToUpdate = user.file.length > 0;
  try {
    let image = {
      imageUrl: user.imageUrl,
      imageId: user.imageId,
    };

    if (hasFileToUpdate) {
      // Upload new file to appwrite storage
      const uploadedFile = await uploadFile(user.file[0]);
      if (!uploadedFile) throw Error;

      // Get new file url
      const fileUrl = getFileView(uploadedFile.$id);
      if (!fileUrl) {
        await deleteFile(uploadedFile.$id);
        throw Error;
      }

      image = { ...image, imageUrl: fileUrl, imageId: uploadedFile.$id };
    }

    //  Update user
    const updatedUser = await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.userCollectionId,
      user.userId,
      {
        name: user.name,
        bio: user.bio,
        imageUrl: image.imageUrl,
        imageId: image.imageId,
      }
    );

    // Failed to update
    if (!updatedUser) {
      // Delete new file that has been recently uploaded
      if (hasFileToUpdate) {
        await deleteFile(image.imageId);
      }
      // If no new file uploaded, just throw error
      throw Error;
    }

    // Safely delete old file after successful update
    if (user.imageId && hasFileToUpdate) {
      await deleteFile(user.imageId);
    }

    return withFileViewUrls(updatedUser);
  } catch (error) {
    console.log(error);
  }
}
