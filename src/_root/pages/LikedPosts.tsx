import GridPostList from "@/components/shared/GridPostList";
import Loader from "@/components/shared/Loader";
import { useGetCurrentUser } from "@/lib/react-query/queriesAndMutations";
import { relationshipDocuments } from "@/lib/appwrite/relationships";
import { Button } from "@/components/ui/button";

const LikedPosts = () => {
  const { data: currentUser, isLoading, refetch } = useGetCurrentUser();

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

  const likedPosts = relationshipDocuments(currentUser.liked);
  return likedPosts.length === 0 ? (
    <p className="text-light-4">No liked posts</p>
  ) : (
    <GridPostList posts={likedPosts} showStats={false} />
  );
};

export default LikedPosts;
