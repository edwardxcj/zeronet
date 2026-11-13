import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { AppwriteException, type Models } from "appwrite";

import { QUERY_KEYS } from "@/lib/react-query/queryKeys";
import {
  createUserAccount,
  signInAccount,
  getCurrentUser,
  signOutAccount,
  getUsers,
  createPost,
  getPostById,
  updatePost,
  getUserPosts,
  deletePost,
  likePost,
  getUserById,
  updateUser,
  getRecentPosts,
  getInfinitePosts,
  getFollowingCreatorIds,
  getFollowingPosts,
  searchPosts,
  savePost,
  deleteSavedPost,
} from "@/lib/appwrite/api";
import { listFollowingAccounts } from "@/lib/appwrite/follows";
import { useUserContext } from "@/context/AuthContext";
import { INewPost, INewUser, IUpdatePost, IUpdateUser } from "@/types";
import { relationshipDocuments, relationshipId } from "@/lib/appwrite/relationships";

const currentUserKey = [QUERY_KEYS.GET_CURRENT_USER];

function retryDocumentRequest(failureCount: number, error: Error) {
  if (error instanceof AppwriteException && [400, 401, 403, 404].includes(error.code)) {
    return false;
  }
  return failureCount < 2;
}

function invalidatePostLists(queryClient: QueryClient) {
  return Promise.all([
    QUERY_KEYS.GET_RECENT_POSTS,
    QUERY_KEYS.GET_FOLLOWING_POSTS,
    QUERY_KEYS.GET_INFINITE_POSTS,
    QUERY_KEYS.GET_USER_POSTS,
    QUERY_KEYS.SEARCH_POSTS,
    QUERY_KEYS.GET_USER_BY_ID,
    QUERY_KEYS.GET_CURRENT_USER,
  ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
}

// ============================================================
// AUTH QUERIES
// ============================================================

export const useCreateUserAccount = () => {
  return useMutation({
    mutationFn: (user: INewUser) => createUserAccount(user),
  });
};

export const useSignInAccount = () => {
  return useMutation({
    mutationFn: (user: { email: string; password: string }) =>
      signInAccount(user),
  });
};

export const useSignOutAccount = () => {
  return useMutation({
    mutationFn: signOutAccount,
  });
};

// ============================================================
// POST QUERIES
// ============================================================

export const useGetPosts = () => {
  return useInfiniteQuery({
    queryKey: [QUERY_KEYS.GET_INFINITE_POSTS],
    queryFn: getInfinitePosts,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + page.documents.length, 0);
      if (loaded >= lastPage.total) return undefined;
      return lastPage.documents[lastPage.documents.length - 1]?.$id;
    },
    retry: retryDocumentRequest,
  });
};

export function useGetFollowingPosts(enabled: boolean) {
  const { user, isAuthenticated } = useUserContext();
  const active = enabled && isAuthenticated && !!user.id;

  const creators = useQuery({
    queryKey: [QUERY_KEYS.GET_FOLLOWING_CREATORS, user.id],
    queryFn: async () => getFollowingCreatorIds(await listFollowingAccounts()),
    enabled: active,
    retry: retryDocumentRequest,
  });

  const posts = useInfiniteQuery({
    queryKey: [QUERY_KEYS.GET_FOLLOWING_POSTS, user.id, creators.data],
    queryFn: ({ pageParam }) => getFollowingPosts(creators.data ?? [], pageParam),
    initialPageParam: null as Parameters<typeof getFollowingPosts>[1],
    getNextPageParam: (lastPage) => lastPage.nextCursors,
    enabled: active && creators.isSuccess && !creators.isFetching,
    retry: retryDocumentRequest,
  });

  return {
    ...posts,
    data: creators.isFetching || creators.isError ? undefined : posts.data,
    isLoading: active && (creators.isPending || creators.isFetching || posts.isLoading),
    isError: creators.isError || posts.isError,
    isFetching: creators.isFetching || posts.isFetching,
    refetch: () => (creators.isError ? creators.refetch() : posts.refetch()),
  };
}

export const useSearchPosts = (searchTerm: string) => {
  return useQuery({
    queryKey: [QUERY_KEYS.SEARCH_POSTS, searchTerm],
    queryFn: () => searchPosts(searchTerm),
    enabled: !!searchTerm,
    retry: retryDocumentRequest,
  });
};

export const useGetRecentPosts = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.GET_RECENT_POSTS],
    queryFn: getRecentPosts,
  });
};

export const useCreatePost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (post: INewPost) => createPost(post),
    onSuccess: (post) => {
      if (post) void invalidatePostLists(queryClient);
    },
  });
};

export const useGetPostById = (postId?: string) => {
  return useQuery({
    queryKey: [QUERY_KEYS.GET_POST_BY_ID, postId],
    queryFn: () => getPostById(postId),
    enabled: !!postId,
    retry: retryDocumentRequest,
  });
};

export const useGetUserPosts = (userId?: string) => {
  return useQuery({
    queryKey: [QUERY_KEYS.GET_USER_POSTS, userId],
    queryFn: () => getUserPosts(userId),
    enabled: !!userId,
    retry: retryDocumentRequest,
  });
};

export const useUpdatePost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (post: IUpdatePost) => updatePost(post),
    onSuccess: (data) => {
      if (!data) return;
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GET_POST_BY_ID, data.$id] });
      void invalidatePostLists(queryClient);
    },
  });
};

export const useDeletePost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, imageId }: { postId: string; imageId?: string }) =>
      deletePost(postId, imageId),
    onSuccess: (_, { postId }) => {
      void queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_POST_BY_ID, postId],
        refetchType: "none",
      });
      void invalidatePostLists(queryClient);
    },
  });
};

export const useLikePost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      postId,
      userId,
      shouldLike,
    }: {
      postId: string;
      userId: string;
      shouldLike: boolean;
    }) => likePost(postId, userId, shouldLike),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GET_POST_BY_ID, data.$id] });
      void invalidatePostLists(queryClient);
    },
  });
};

export const useSavePost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, post }: { userId: string; post: Models.Document }) =>
      savePost(userId, post.$id),
    onSuccess: async (record, { post, userId }) => {
      await queryClient.cancelQueries({ queryKey: currentUserKey });
      queryClient.setQueryData<Models.Document | null>(currentUserKey, (profile) => {
        if (!profile || profile.$id !== userId) return profile;
        const otherRecords = relationshipDocuments(profile.save).filter(
          (saved) => relationshipId(saved.post) !== post.$id
        );
        return { ...profile, save: [...otherRecords, { ...record, post }] };
      });
    },
  });
};

export const useDeleteSavedPost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (savedRecordId: string) => deleteSavedPost(savedRecordId),
    onSuccess: async (_, savedRecordId) => {
      await queryClient.cancelQueries({ queryKey: currentUserKey });
      queryClient.setQueryData<Models.Document | null>(currentUserKey, (profile) => {
        if (!profile) return profile;
        return {
          ...profile,
          save: relationshipDocuments(profile.save).filter((record) => record.$id !== savedRecordId),
        };
      });
    },
  });
};

// ============================================================
// USER QUERIES
// ============================================================

export const useGetCurrentUser = () => {
  return useQuery({
    queryKey: currentUserKey,
    queryFn: getCurrentUser,
  });
};

export const useGetUsers = (limit?: number) => {
  return useQuery({
    queryKey: [QUERY_KEYS.GET_USERS, limit],
    queryFn: () => getUsers(limit),
  });
};

export const useGetUserById = (userId: string) => {
  return useQuery({
    queryKey: [QUERY_KEYS.GET_USER_BY_ID, userId],
    queryFn: () => getUserById(userId),
    enabled: !!userId,
    retry: retryDocumentRequest,
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (user: IUpdateUser) => updateUser(user),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_CURRENT_USER],
      });
      queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_USER_BY_ID, data?.$id],
      });
    },
  });
};
