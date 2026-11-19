import { AppwriteException } from "appwrite";
import { useInfiniteQuery } from "@tanstack/react-query";

import { useUserContext } from "@/context/AuthContext";
import { getHomeFeedPage } from "@/lib/appwrite/homeFeed";
import { QUERY_KEYS } from "./queryKeys";

export function useHomeFeed(enabled: boolean) {
  const { user, isAuthenticated } = useUserContext();
  return useInfiniteQuery({
    // Keep the existing mutation invalidations, without sharing useQuery's shape.
    queryKey: [QUERY_KEYS.GET_RECENT_POSTS, "homePages", user.id],
    queryFn: ({ pageParam }) => getHomeFeedPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: enabled && isAuthenticated && !!user.id,
    staleTime: 30_000,
    gcTime: 60 * 60_000,
    retry: (failureCount, error) => {
      if (error instanceof AppwriteException && [400, 401, 403, 404].includes(error.code)) return false;
      return failureCount < 2;
    },
  });
}
