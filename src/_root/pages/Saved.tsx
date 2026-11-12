import GridPostList from "@/components/shared/GridPostList";
import Loader from "@/components/shared/Loader";
import { Button } from "@/components/ui/button";
import { useGetCurrentUser } from "@/lib/react-query/queriesAndMutations";
import { relationshipDocuments } from "@/lib/appwrite/relationships";

const Saved = () => {
  const { data: currentUser, isPending, isPaused, isFetching, refetch } =
    useGetCurrentUser();

  const savedPosts = relationshipDocuments(
    relationshipDocuments(currentUser?.save).map((record) => record.post)
  ).reverse();

  return (
    <div className="saved-container">
      <div className="flex gap-2 w-full max-w-5xl">
        <img
          src="/assets/icons/save.svg"
          width={36}
          height={36}
          alt=""
          className="invert-white"
        />
        <h2 className="h3-bold md:h2-bold text-left w-full">Saved Posts</h2>
      </div>

      {isPending && !isPaused ? (
        <Loader />
      ) : !currentUser ? (
        <div className="flex flex-col items-center gap-3" role="status">
          <p className="text-light-4">Could not load saved posts.</p>
          <Button
            className="shad-button_dark_4"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </div>
      ) : savedPosts.length > 0 ? (
        <GridPostList posts={savedPosts} showStats={false} />
      ) : (
        <p className="text-light-4">No saved posts to show.</p>
      )}
    </div>
  );
};

export default Saved;
