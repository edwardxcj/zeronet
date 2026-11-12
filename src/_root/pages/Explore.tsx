import { useEffect, useState } from "react";
import { useInView } from "react-intersection-observer";

import GridPostList from "@/components/shared/GridPostList";
import Loader from "@/components/shared/Loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useDebounce from "@/hooks/useDebounce";
import {
  useGetPosts,
  useSearchPosts,
} from "@/lib/react-query/queriesAndMutations";

const Explore = () => {
  const { ref, inView } = useInView();
  const [searchValue, setSearchValue] = useState("");
  const searchTerm = searchValue.trim();
  const isSearching = searchTerm.length > 0;
  const debouncedSearch = useDebounce(searchTerm, 500);
  const feed = useGetPosts();
  const search = useSearchPosts(isSearching ? debouncedSearch : "");
  const activeQuery = isSearching ? search : feed;
  const {
    fetchNextPage,
    fetchStatus,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isError,
  } = feed;
  const posts = isSearching
    ? search.data?.documents ?? []
    : feed.data?.pages.flatMap((page) => page?.documents ?? []) ?? [];
  const isLoading =
    (isSearching && searchTerm !== debouncedSearch) ||
    (activeQuery.isPending && !activeQuery.isPaused);
  const hasFeedUpdateError = feed.isRefetchError;

  useEffect(() => {
    if (
      inView &&
      !isSearching &&
      hasNextPage &&
      fetchStatus === "idle" &&
      !isError
    ) {
      void fetchNextPage({ cancelRefetch: false });
    }
  }, [fetchNextPage, fetchStatus, hasNextPage, inView, isError, isSearching]);

  return (
    <div className="explore-container">
      <div className="explore-inner_container">
        <h2 className="h3-bold md:h2-bold w-full">Search Posts</h2>
        <div className="flex gap-1 px-4 w-full rounded-lg bg-dark-4">
          <img
            src="/assets/icons/search.svg"
            width={24}
            height={24}
            alt=""
          />
          <Input
            type="text"
            placeholder="Search"
            aria-label="Search posts"
            className="explore-search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
          />
        </div>
      </div>

      <h3 className="body-bold md:h3-bold w-full max-w-5xl mt-16 mb-7">
        {isSearching ? "Search Results" : "Recently Updated"}
      </h3>

      <div className="flex flex-wrap gap-9 w-full max-w-5xl">
        {isLoading ? (
          <Loader />
        ) : !activeQuery.data ? (
          <div className="flex w-full flex-col items-center gap-3" role="status">
            <p className="text-light-4">
              {isSearching ? "Could not search posts." : "Could not load posts."}
            </p>
            <Button
              className="shad-button_dark_4"
              disabled={activeQuery.isFetching}
              onClick={() => void activeQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : posts.length > 0 ? (
          <GridPostList posts={posts} />
        ) : (
          <p className="text-light-4 mt-10 text-center w-full">
            {isSearching ? "No results found." : "No posts yet."}
          </p>
        )}
      </div>

      {!isSearching && (hasNextPage || hasFeedUpdateError) && (
        <div ref={ref} className="mt-10 min-h-px">
          {hasFeedUpdateError ? (
            <div className="flex flex-col items-center gap-3" role="status">
              <p className="text-light-4">Could not update posts.</p>
              <Button
                className="shad-button_dark_4"
                disabled={isFetching}
                onClick={() => void feed.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : (
            isFetchingNextPage && <Loader />
          )}
        </div>
      )}
    </div>
  );
};

export default Explore;
