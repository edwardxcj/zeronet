import GridPostList from "@/components/shared/GridPostList";
import Loader from "@/components/shared/Loader";
import { useGetCurrentUser } from "@/lib/react-query/queriesAndMutations";
import { Button } from "@/components/ui/button";
import { useCollectedPosts } from "@/lib/react-query/postCollections";

const LikedPosts = () => {
  const { data: currentUser, isLoading, refetch } = useGetCurrentUser();
  const posts = useCollectedPosts("liked", currentUser);

  if (isLoading)
    return (
      <div className="flex-center w-full h-full">
        <Loader />
      </div>
    );

  if (!currentUser) {
    return (
      <div className="flex-center flex-col gap-4">
        <p role="alert">Couldn’t load your liked posts.</p>
        <Button onClick={() => void refetch()}>Try again</Button>
      </div>
    );
  }

  if (posts.isPending && !posts.isPaused) return <Loader />;
  if (!posts.data) return (
    <div className="flex-center flex-col gap-4" role="status">
      <p className="text-light-4">Couldn’t load your liked posts.</p>
      <Button disabled={posts.isFetching} onClick={() => void posts.refetch()}>Try again</Button>
    </div>
  );

  return posts.data.length === 0 ? (
    <p className="text-light-4">No liked posts</p>
  ) : (
    <GridPostList posts={posts.data} showStats={false} />
  );
};

export default LikedPosts;
