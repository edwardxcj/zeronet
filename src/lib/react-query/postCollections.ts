import { AppwriteException, type Models } from "appwrite";
import { useQuery } from "@tanstack/react-query";

import { useUserContext } from "@/context/AuthContext";
import { collectedPostIds, getCollectedPosts, type PostCollection } from "@/lib/appwrite/postCollections";

export function useCollectedPosts(collection: PostCollection, profile?: Models.Document | null) {
  const { user, isAuthenticated } = useUserContext();
  const ids = collectedPostIds(profile, collection);
  return useQuery({
    queryKey: ["collectedPosts", user.id, collection, ids],
    queryFn: () => getCollectedPosts(ids),
    enabled: isAuthenticated && !!user.id && profile?.$id === user.id,
    staleTime: 0,
    retry: (failureCount, error) => {
      if (error instanceof AppwriteException && [400, 401, 403, 404].includes(error.code)) return false;
      return failureCount < 2;
    },
  });
}
