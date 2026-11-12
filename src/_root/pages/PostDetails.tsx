import { AppwriteException } from "appwrite";
import { useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import Loader from "@/components/shared/Loader";
import PostStats from "@/components/shared/PostStats";
import GridPostList from "@/components/shared/GridPostList";

import {
  useGetPostById,
  useGetUserPosts,
  useDeletePost,
} from "@/lib/react-query/queriesAndMutations";
import { multiFormatDateString } from "@/lib/utils";
import { useUserContext } from "@/context/AuthContext";

const PostDetails = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useUserContext();
  const { toast } = useToast();
  const deletionInFlight = useRef(false);

  const { data: post, error, isLoading, isFetching, refetch } = useGetPostById(id);
  const creator = post?.creator;
  const creatorId = creator?.$id;
  const canManagePost = !!user.id && user.id === creatorId;
  const {
    data: userPosts,
    isLoading: isUserPostLoading,
    isError: isUserPostError,
  } = useGetUserPosts(creatorId);
  const { mutateAsync: deletePost, isPending: isDeleting } = useDeletePost();

  const relatedPosts = (userPosts?.documents ?? []).filter(
    (userPost) => userPost?.$id && userPost.$id !== post?.$id
  );

  const handleDeletePost = async () => {
    if (!post || !canManagePost || deletionInFlight.current) return;
    if (!window.confirm("Permanently delete this post?")) return;

    deletionInFlight.current = true;
    try {
      await deletePost({ postId: post.$id, imageId: post.imageId });
      navigate("/", { replace: true });
    } catch {
      toast({
        variant: "destructive",
        title: "Could not delete the post",
        description: "Please try again.",
      });
    } finally {
      deletionInFlight.current = false;
    }
  };

  if (isLoading || !post) {
    const canRetry =
      !!error && !(error instanceof AppwriteException && error.code === 404);
    return (
      <div className="post_details-container">
        {isLoading ? (
          <Loader />
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <h2 className="h3-bold">
              {canRetry ? "Could not load the post" : "Post not found"}
            </h2>
            {canRetry && (
              <Button
                variant="outline"
                disabled={isFetching}
                onClick={() => void refetch()}
              >
                {isFetching ? "Loading…" : "Try again"}
              </Button>
            )}
            <Button variant="ghost" asChild>
              <Link to="/">Back to Home</Link>
            </Button>
          </div>
        )}
      </div>
    );
  }

  const tags = Array.isArray(post.tags)
    ? post.tags.filter((tag) => typeof tag === "string" && tag.trim())
    : [];
  const creatorInfo = (
    <>
      <img
        src={creator?.imageUrl || "/assets/icons/profile-placeholder.svg"}
        alt=""
        className="w-8 h-8 lg:w-12 lg:h-12 rounded-full"
      />
      <div className="flex gap-1 flex-col">
        <p className="base-medium lg:body-bold text-light-1">
          {creator?.name || "Unknown author"}
        </p>
        <div className="flex-center gap-2 text-light-3">
          <p className="subtle-semibold lg:small-regular">
            {multiFormatDateString(post.$createdAt)}
          </p>
          {post.location && (
            <>
              •
              <p className="subtle-semibold lg:small-regular">{post.location}</p>
            </>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="post_details-container">
      <div className="hidden md:flex max-w-5xl w-full">
        <Button
          onClick={() => navigate(-1)}
          variant="ghost"
          className="shad-button_ghost"
        >
          <img
            src={"/assets/icons/back.svg"}
            alt="back"
            width={24}
            height={24}
          />
          <p className="small-medium lg:base-medium">Back</p>
        </Button>
      </div>

      <div className="post_details-card">
        <img src={post.imageUrl} alt="Post image" className="post_details-img" />

        <div className="post_details-info">
          <div className="flex-between w-full">
            {creatorId ? (
              <Link
                to={`/profile/${creatorId}`}
                className="flex items-center gap-3"
              >
                {creatorInfo}
              </Link>
            ) : (
              <div className="flex items-center gap-3">{creatorInfo}</div>
            )}

            {canManagePost && (
              <div className="flex-center gap-4">
                <Link to={`/update-post/${post.$id}`} aria-label="Edit post">
                  <img
                    src={"/assets/icons/edit.svg"}
                    alt=""
                    width={24}
                    height={24}
                  />
                </Link>

                <Button
                  onClick={handleDeletePost}
                  variant="ghost"
                  className="post_details-delete_btn"
                  disabled={isDeleting}
                  aria-busy={isDeleting}
                  aria-label={isDeleting ? "Deleting post" : "Delete post"}
                >
                  <img
                    src={"/assets/icons/delete.svg"}
                    alt=""
                    width={24}
                    height={24}
                  />
                </Button>
              </div>
            )}
          </div>

          <hr className="border w-full border-dark-4/80" />

          <div className="flex flex-col flex-1 w-full small-medium lg:base-regular">
            <p>{post.caption}</p>
            {tags.length > 0 && (
              <ul className="flex gap-1 mt-2">
                {tags.map((tag, index) => (
                  <li
                    key={`${tag}${index}`}
                    className="text-light-3 small-regular"
                  >
                    #{tag}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="w-full">
            <PostStats post={post} userId={user.id} />
          </div>
        </div>
      </div>

      {creatorId && (
        <div className="w-full max-w-5xl">
          <hr className="border w-full border-dark-4/80" />

          <h3 className="body-bold md:h3-bold w-full my-10">
            More Related Posts
          </h3>
          {isUserPostLoading ? (
            <Loader />
          ) : relatedPosts.length > 0 ? (
            <GridPostList posts={relatedPosts} />
          ) : (
            <p className="text-light-3">
              {isUserPostError
                ? "Could not load related posts."
                : "No related posts yet."}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default PostDetails;
