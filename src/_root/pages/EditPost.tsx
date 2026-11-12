import PostForm from "@/components/forms/PostForm";
import Loader from "@/components/shared/Loader";
import { useGetPostById } from "@/lib/react-query/queriesAndMutations";
import { Link, useParams } from "react-router-dom";

const EditPost = () => {
  const { id } = useParams();
  const { data: post, isLoading } = useGetPostById(id);

  if (isLoading) return <Loader />;

  return (
    <div className="flex flex-1">
      <div className="common-container">
        <div className="max-w-5xl flex-start gap-3 justify-start w-full">
          <img
            src="/assets/icons/add-post.svg"
            width={36}
            height={36}
            alt="add"
          />
          <h2 className="h3-bold md:h2-bold text-left w-full">Edit Post</h2>
        </div>

        {post ? (
          <PostForm key={post.$id} action="Update" post={post} />
        ) : (
          <div className="w-full max-w-5xl space-y-3">
            <p role="alert">This post could not be loaded.</p>
            <Link to="/" className="text-primary-500 underline">
              Back to home
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditPost;
