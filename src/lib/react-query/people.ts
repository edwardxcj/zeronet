import { useMemo } from "react";
import { AppwriteException } from "appwrite";
import { useInfiniteQuery } from "@tanstack/react-query";

import { useUserContext } from "@/context/AuthContext";
import { getPeoplePage } from "@/lib/appwrite/people";

export function usePeople() {
  const { user } = useUserContext();
  const query = useInfiniteQuery({
    queryKey: ["people", user.id],
    queryFn: ({ pageParam }) => getPeoplePage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof AppwriteException && error.code >= 400 && error.code < 500) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const people = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages.flatMap((page) => page.documents) ?? []).filter((person) => {
      if (seen.has(person.$id)) return false;
      seen.add(person.$id);
      return true;
    });
  }, [query.data]);

  return { ...query, people };
}
