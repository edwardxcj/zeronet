import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import { useUserContext } from "@/context/AuthContext";
import {
  createComment,
  deleteComment,
  getPostLikes,
  getComment,
  getCommentCount,
  listComments,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
  type Comment,
} from "@/lib/appwrite/social";

const commentCountKey = (userId: string, postId?: string) =>
  ["commentCount", userId, postId] as const;

export function useCommentCount(postId?: string, enabled = true) {
  const { user, isAuthenticated } = useUserContext();
  return useQuery({
    queryKey: commentCountKey(user.id, postId),
    queryFn: () => {
      if (!postId) throw new Error("A post is required.");
      return getCommentCount(postId);
    },
    enabled: enabled && isAuthenticated && !!user.id && !!postId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: false,
  });
}

export function useComments(postId: string, rootId?: string, enabled = true) {
  const { user, isAuthenticated } = useUserContext();
  return useInfiniteQuery({
    queryKey: ["comments", user.id, postId, rootId ?? null],
    queryFn: ({ pageParam }) => listComments(postId, rootId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: enabled && isAuthenticated && !!postId,
    retry: false,
  });
}

export function useCreateComment(postId: string) {
  const { user } = useUserContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { content: string; parentId?: string; requestId: string }) =>
      createComment({ postId, ...input }),
    onSuccess: (comment) => {
      queryClient.setQueryData(["comment", user.id, postId, comment.$id], comment);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["comments", user.id, postId] }),
        queryClient.invalidateQueries({ queryKey: commentCountKey(user.id, postId) }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["notificationUnread"] }),
      ]);
    },
  });
}

export function useDeleteComment(postId: string) {
  const { user } = useUserContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteComment,
    onSuccess: async ({ commentId }) => {
      const queryKey = ["comments", user.id, postId];
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<Comment>(
        ["comment", user.id, postId, commentId],
        (comment) => comment && { ...comment, content: "", deleted: true, canDelete: false }
      );
      queryClient.setQueriesData<InfiniteData<Awaited<ReturnType<typeof listComments>>>>(
        { queryKey },
        (data) => data && {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            comments: page.comments.map((comment) => comment.$id === commentId
              ? { ...comment, content: "", deleted: true, canDelete: false }
              : comment),
          })),
        }
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: commentCountKey(user.id, postId) }),
        queryClient.invalidateQueries({ queryKey: ["comment", user.id, postId] }),
      ]);
    },
  });
}

export function useComment(postId: string, commentId?: string) {
  const { user, isAuthenticated } = useUserContext();
  return useQuery({
    queryKey: ["comment", user.id, postId, commentId],
    queryFn: async () => {
      if (!commentId) throw new Error("A comment is required.");
      const comment = await getComment(commentId);
      if (comment.postId !== postId) throw new Error("The comment belongs to another post.");
      return comment;
    },
    enabled: isAuthenticated && !!postId && !!commentId,
    retry: false,
  });
}

export function usePostLikes(postId?: string, enabled = true) {
  const { user, isAuthenticated } = useUserContext();
  return useQuery({
    queryKey: ["postLikes", user.id, postId],
    queryFn: () => {
      if (!postId) throw new Error("A post is required.");
      return getPostLikes(postId);
    },
    enabled: enabled && isAuthenticated && !!postId,
    retry: false,
  });
}

export function useNotifications() {
  const { user, isAuthenticated } = useUserContext();
  return useInfiniteQuery({
    queryKey: ["notifications", user.id],
    queryFn: ({ pageParam }) => listNotifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isAuthenticated && !!user.id,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function useUnreadNotificationCount({
  enabled = true,
  refetchInterval = false,
}: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  const { user, isAuthenticated } = useUserContext();
  return useQuery({
    queryKey: ["notificationUnread", user.id],
    queryFn: unreadNotificationCount,
    enabled: enabled && isAuthenticated && !!user.id,
    refetchInterval,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

type NotificationPages = InfiniteData<Awaited<ReturnType<typeof listNotifications>>>;

export function useMarkNotificationRead() {
  const { user } = useUserContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onMutate: () => queryClient.cancelQueries({ queryKey: ["notifications", user.id] }),
    onSuccess: ({ id }) => {
      queryClient.setQueryData<NotificationPages>(["notifications", user.id], (data) =>
        data && {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            notifications: page.notifications.map((notification) =>
              notification.$id === id ? { ...notification, read: true } : notification
            ),
          })),
        }
      );
      return queryClient.invalidateQueries({ queryKey: ["notificationUnread", user.id] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const { user } = useUserContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notificationUnread", user.id] }),
        queryClient.invalidateQueries({ queryKey: ["notifications", user.id] }),
      ]),
  });
}
