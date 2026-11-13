import { useEffect, useRef, useState } from "react";
import { useInView } from "react-intersection-observer";
import { Link } from "react-router-dom";

import {
  useGetFollowingPosts,
  useGetRecentPosts,
  useGetUsers,
} from "@/lib/react-query/queriesAndMutations";
import Loader from "@/components/shared/Loader";
import PostCard from "@/components/shared/PostCard";
import UserCard from "@/components/shared/UserCard";
import { Button } from "@/components/ui/button";
import { useUserContext } from "@/context/AuthContext";

const feeds = [
  { id: "all", label: "All posts" },
  { id: "following", label: "Following" },
] as const;

type Feed = (typeof feeds)[number]["id"];

function FeedError({
  message,
  isFetching,
  onRetry,
}: {
  message: string;
  isFetching: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p role="status" className="text-light-3">{message}</p>
      <Button
        type="button"
        className="shad-button_dark_4"
        disabled={isFetching}
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}

const Home = () => {
  const [feed, setFeed] = useState<Feed>("all");
  const feedContainer = useRef<HTMLDivElement>(null);
  const { ref: nextPageRef, inView } = useInView({
    rootMargin: "120px",
    fallbackInView: false,
  });
  const { isAuthenticated, isLoading: isAuthLoading } = useUserContext();
  const isFollowingFeed = feed === "following";

  const recentPosts = useGetRecentPosts();
  const followingPosts = useGetFollowingPosts(isFollowingFeed);
  const activeFeed = isFollowingFeed ? followingPosts : recentPosts;
  const posts = isFollowingFeed
    ? followingPosts.data?.pages.flatMap((page) => page.documents)
    : recentPosts.data?.documents;
  const {
    fetchNextPage,
    fetchStatus,
    hasNextPage,
    isFetchingNextPage,
    isError: isFollowingError,
  } = followingPosts;
  const {
    data: creators,
    isLoading: isUserLoading,
    isFetching: isUserFetching,
    refetch: refetchCreators,
  } = useGetUsers(10);

  useEffect(() => {
    if (
      isFollowingFeed &&
      inView &&
      hasNextPage &&
      fetchStatus === "idle" &&
      !isFollowingError
    ) {
      void fetchNextPage({ cancelRefetch: false });
    }
  }, [fetchNextPage, fetchStatus, hasNextPage, inView, isFollowingError, isFollowingFeed]);

  const selectFeed = (nextFeed: Feed) => {
    if (nextFeed === feed) return;
    setFeed(nextFeed);
    feedContainer.current?.scrollTo({ top: 0 });
  };

  return (
    <div className="flex flex-1">
      <div ref={feedContainer} className="home-container scroll-auto">
        <div className="home-posts">
          <div className="flex w-full flex-col gap-4">
            <h2 className="h3-bold md:h2-bold">Home</h2>
            <div
              role="group"
              aria-label="Choose a feed"
              className="inline-flex w-fit gap-1 rounded-xl border border-dark-4 bg-dark-2 p-1"
            >
              {feeds.map(({ id, label }) => (
                <Button
                  key={id}
                  type="button"
                  variant="ghost"
                  aria-pressed={feed === id}
                  aria-controls="home-feed"
                  className={`rounded-lg px-5 ${
                    feed === id
                      ? "bg-primary-500 text-white hover:bg-primary-500"
                      : "text-light-3 hover:bg-dark-4 hover:text-white"
                  }`}
                  onClick={() => selectFeed(id)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <section
            id="home-feed"
            aria-label={isFollowingFeed ? "Following" : "All posts"}
            className="flex w-full flex-col items-center gap-6"
          >
            {activeFeed.isLoading || (isFollowingFeed && isAuthLoading) ? (
              <Loader />
            ) : isFollowingFeed && !isAuthenticated ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <p className="text-light-3">Sign in to see posts from people you follow.</p>
                <Link to="/sign-in" className="text-primary-500 hover:underline">Sign in</Link>
              </div>
            ) : !posts || (activeFeed.isError && posts.length === 0) ? (
              <FeedError
                message={isFollowingFeed ? "Could not load your Following feed." : "Could not load posts."}
                isFetching={activeFeed.isFetching}
                onRetry={() => void activeFeed.refetch()}
              />
            ) : posts.length === 0 && !(isFollowingFeed && hasNextPage) ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-light-3">
                  {isFollowingFeed ? "No posts from people you follow yet." : "No posts yet."}
                </p>
                {isFollowingFeed && (
                  <Link to="/all-users" className="text-primary-500 hover:underline">Find people to follow</Link>
                )}
              </div>
            ) : (
              <>
                {posts.length > 0 && (
                  <ul className="flex w-full flex-col gap-9">
                    {posts.map((post) => (
                      <li key={post.$id} className="flex justify-center w-full">
                        <PostCard post={post} />
                      </li>
                    ))}
                  </ul>
                )}
                {activeFeed.isError ? (
                  <FeedError
                    message="Could not update posts."
                    isFetching={activeFeed.isFetching}
                    onRetry={() => void activeFeed.refetch()}
                  />
                ) : isFollowingFeed && hasNextPage && (
                  <div ref={nextPageRef} className="flex w-full justify-center">
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-light-3 hover:bg-dark-4"
                      disabled={fetchStatus !== "idle"}
                      onClick={() => void fetchNextPage({ cancelRefetch: false })}
                    >
                      {isFetchingNextPage ? "Loading…" : "Load more"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <div className="home-creators">
        <h3 className="h3-bold text-light-1">Top Creators</h3>
        {isUserLoading && !creators ? (
          <Loader />
        ) : !creators ? (
          <FeedError
            message="Could not load creators."
            isFetching={isUserFetching}
            onRetry={() => void refetchCreators()}
          />
        ) : (
          <ul className="grid 2xl:grid-cols-2 gap-6">
            {creators.documents.map((creator) => (
              <li key={creator.$id}>
                <UserCard user={creator} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Home;
