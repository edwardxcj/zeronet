import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInView } from "react-intersection-observer";
import { Link } from "react-router-dom";

import {
  useGetFollowingPosts,
  useGetUsers,
} from "@/lib/react-query/queriesAndMutations";
import { useHomeFeed } from "@/lib/react-query/homeFeed";
import {
  captureHomeScroll,
  readHomeView,
  rememberHomeFeed,
  rememberHomeScroll,
  restoreHomeScroll,
  uniqueFeedPosts,
  type HomeFeed,
} from "@/lib/homeFeedState";
import Loader from "@/components/shared/Loader";
import PostCard from "@/components/shared/PostCard";
import UserCard from "@/components/shared/UserCard";
import { Button } from "@/components/ui/button";
import { useUserContext } from "@/context/AuthContext";

const feeds = [
  { id: "all", label: "All posts" },
  { id: "following", label: "Following" },
] as const;

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

const HomeContent = ({ viewerId }: { viewerId: string }) => {
  const [feed, setFeed] = useState<HomeFeed>(() => readHomeView(viewerId).feed);
  const [ready, setReady] = useState(false);
  const feedContainer = useRef<HTMLDivElement>(null);
  const restoredFeed = useRef<HomeFeed>();
  const pageCount = useRef(0);
  const desiredPosition = useMemo(() => readHomeView(viewerId).positions[feed], [viewerId, feed]);
  const { ref: nextPageRef, inView } = useInView({
    rootMargin: "120px",
    fallbackInView: false,
  });
  const { isAuthenticated, isLoading: isAuthLoading } = useUserContext();
  const isFollowingFeed = feed === "following";

  const recentPosts = useHomeFeed(!isFollowingFeed);
  const followingPosts = useGetFollowingPosts(isFollowingFeed);
  const retainedFollowing = useRef(followingPosts.data);
  if (followingPosts.data) retainedFollowing.current = followingPosts.data;
  const activeFeed = isFollowingFeed ? followingPosts : recentPosts;
  // The existing Following hook hides data while refreshing creator IDs. Keep
  // its last loaded cards mounted so that a background refresh cannot clamp scroll.
  const data = isFollowingFeed ? followingPosts.data ?? retainedFollowing.current : recentPosts.data;
  const posts = useMemo(() => data ? uniqueFeedPosts(data.pages) : undefined, [data]);
  const loadedPages = data?.pages.length ?? 0;
  pageCount.current = loadedPages;
  const {
    fetchNextPage,
    fetchStatus,
    hasNextPage,
    isFetchingNextPage,
    isError,
    isFetching,
  } = activeFeed;
  const {
    data: creators,
    isLoading: isUserLoading,
    isFetching: isUserFetching,
    refetch: refetchCreators,
  } = useGetUsers(10);

  useLayoutEffect(() => {
    const container = feedContainer.current;
    if (!container) return;
    const save = () => {
      if (restoredFeed.current === feed) {
        rememberHomeScroll(viewerId, feed, captureHomeScroll(container, pageCount.current));
      }
    };
    const stopRestoring = () => {
      if (restoredFeed.current === feed || pageCount.current === 0) return;
      restoredFeed.current = feed;
      setReady(true);
      save();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) stopRestoring();
    };
    container.addEventListener("scroll", save, { passive: true });
    container.addEventListener("wheel", stopRestoring, { passive: true });
    container.addEventListener("touchstart", stopRestoring, { passive: true });
    container.addEventListener("keydown", onKeyDown);
    return () => {
      // Capture this actual element before React removes it on navigation.
      save();
      container.removeEventListener("scroll", save);
      container.removeEventListener("wheel", stopRestoring);
      container.removeEventListener("touchstart", stopRestoring);
      container.removeEventListener("keydown", onKeyDown);
    };
  }, [viewerId, feed]);

  useLayoutEffect(() => {
    if (restoredFeed.current === feed || !posts || !feedContainer.current) return;
    // The cache normally supplies these pages immediately. If it expired while
    // visiting a post, recover only the number of pages the viewer had loaded.
    if (loadedPages < desiredPosition.pages && hasNextPage && !isError) {
      if (fetchStatus === "idle" && !isFetching) void fetchNextPage({ cancelRefetch: false });
      return;
    }
    restoreHomeScroll(feedContainer.current, desiredPosition);
    restoredFeed.current = feed;
    setReady(true);
  }, [feed, posts, loadedPages, desiredPosition, hasNextPage, isError, isFetching, fetchStatus, fetchNextPage]);

  useEffect(() => {
    if (
      ready &&
      inView &&
      hasNextPage &&
      fetchStatus === "idle" &&
      !isFetching &&
      !isError
    ) {
      void fetchNextPage({ cancelRefetch: false });
    }
  }, [fetchNextPage, fetchStatus, hasNextPage, inView, isError, isFetching, ready]);

  const selectFeed = (nextFeed: HomeFeed) => {
    if (nextFeed === feed) return;
    if (feedContainer.current && restoredFeed.current === feed) {
      rememberHomeScroll(viewerId, feed, captureHomeScroll(feedContainer.current, loadedPages));
    }
    rememberHomeFeed(viewerId, nextFeed);
    restoredFeed.current = undefined;
    setReady(false);
    setFeed(nextFeed);
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
            {(activeFeed.isLoading && !posts) || (isFollowingFeed && isAuthLoading) ? (
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
            ) : posts.length === 0 && !hasNextPage ? (
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
                {!ready && desiredPosition.top > 0 && (
                  <p role="status" className="sr-only">Restoring your place…</p>
                )}
                {posts.length > 0 && (
                  <ul className="flex w-full flex-col gap-9">
                    {posts.map((post) => (
                      <li key={post.$id} data-home-post={post.$id} className="flex justify-center w-full">
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
                ) : hasNextPage && (
                  <div ref={nextPageRef} className="flex w-full justify-center">
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-light-3 hover:bg-dark-4"
                      disabled={fetchStatus !== "idle" || isFetching || !ready}
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

const Home = () => {
  const { user, isLoading } = useUserContext();
  if (isLoading) return <div className="flex-center w-full h-full"><Loader /></div>;
  return <HomeContent key={user.id || "guest"} viewerId={user.id || "guest"} />;
};

export default Home;
