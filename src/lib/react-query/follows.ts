import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useUserContext } from "@/context/AuthContext";
import { getFollow, setFollow, type FollowState } from "@/lib/appwrite/follows";

const pairKey = (viewerId: string, targetId?: string) =>
  ["follow", viewerId, targetId] as const;

const readKey = (viewerId: string, targetId: string | undefined, includeCounts: boolean) =>
  [...pairKey(viewerId, targetId), includeCounts] as const;

export function useGetFollow(targetId?: string, includeCounts = false, enabled = true) {
  const { user, isAuthenticated } = useUserContext();

  return useQuery({
    queryKey: readKey(user.id, targetId, includeCounts),
    queryFn: () => {
      if (!targetId) throw new Error("Missing follow target.");
      return getFollow(targetId, includeCounts);
    },
    enabled:
      enabled &&
      isAuthenticated &&
      !!user.id &&
      !!targetId &&
      (includeCounts || user.id !== targetId),
    staleTime: 30_000,
    refetchOnWindowFocus: includeCounts ? "always" : true,
    retry: false,
  });
}

export function useSetFollow(targetId: string) {
  const { user, isAuthenticated } = useUserContext();
  const queryClient = useQueryClient();
  const queryKey = pairKey(user.id, targetId);
  const mutationKey = ["setFollow", user.id, targetId];
  const pendingCount = useIsMutating({ mutationKey, exact: true });

  const mutation = useMutation({
    mutationKey,
    mutationFn: (following: boolean) => setFollow(targetId, following),
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: async ({ following }) => {
      // A read started during the write can still contain the previous state.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<FollowState>(readKey(user.id, targetId, false), { following });
      queryClient.setQueryData<FollowState>(
        readKey(user.id, targetId, true),
        (previous) => previous && { ...previous, following }
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({
          queryKey: readKey(user.id, user.id, true),
          exact: true,
        }),
      ]),
  });

  return {
    isPending: mutation.isPending || pendingCount > 0,
    setFollowing: (following: boolean, onError: () => void) => {
      if (
        !isAuthenticated ||
        !user.id ||
        !targetId ||
        user.id === targetId ||
        queryClient.isMutating({ mutationKey, exact: true })
      ) {
        return;
      }
      mutation.mutate(following, { onError });
    },
  };
}
