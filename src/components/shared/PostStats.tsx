import React, { useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useIsMutating } from "@tanstack/react-query";
import { useInView } from "react-intersection-observer";
import {
  useLikePost,
  useSavePost,
  useDeleteSavedPost,
  useGetCurrentUser,
} from "@/lib/react-query/queriesAndMutations";
import { Models } from "appwrite";
import { checkIsLiked } from "@/lib/utils";
import {
  relationshipDocuments,
  relationshipId,
  relationshipIds,
} from "@/lib/appwrite/relationships";
import { useToast } from "@/components/ui/use-toast";
import { Loader } from "lucide-react";
import { useCommentCount, usePostLikes } from "@/lib/react-query/social";
import SharePostButton from "./SharePostButton";

type PostStatsProps = {
  post?: Models.Document;
  userId: string;
};

const PostStats = ({ post, userId }: PostStatsProps) => {
  const { ref, inView } = useInView({ fallbackInView: false });
  const commentCount = useCommentCount(post?.$id, inView);
  const [likes, setLikes] = useState(() => relationshipIds(post?.likes));
  const likeRequest = useRef(false);
  const embeddedLikes = relationshipIds(post?.likes);
  const likeState = usePostLikes(post?.$id, embeddedLikes === undefined);
  const pendingLikes = useIsMutating({
    mutationKey: ["likePost"],
    predicate: (mutation) => {
      const variables = mutation.state.variables as { postId?: string; userId?: string } | undefined;
      return variables?.postId === post?.$id && variables?.userId === userId;
    },
  });
  const { toast } = useToast();

  const { mutateAsync: likePost, isPending: isLiking } = useLikePost();
  const { mutateAsync: savePost, isPending: isSavingPost } = useSavePost();
  const { mutateAsync: deleteSavedPost, isPending: isDeletingSaved } =
    useDeleteSavedPost();

  const { data: currentUser } = useGetCurrentUser();

  const savedRecords = relationshipDocuments(currentUser?.save);
  const savedPostRecord = savedRecords.find(
    (record) => post && relationshipId(record.post) === post.$id
  );
  const isSaved = !!savedPostRecord;
  const savedRecordsKnown =
    Array.isArray(currentUser?.save) &&
    savedRecords.length === currentUser.save.length &&
    savedRecords.every((record) => relationshipId(record.post) !== undefined);
  const canSave =
    !!post && !!userId && currentUser?.$id === userId && (isSaved || savedRecordsKnown);

  useEffect(() => {
    setLikes(relationshipIds(post?.likes) ?? likeState.data?.likes);
  }, [post?.$id, post?.likes]);

  useEffect(() => {
    if (likeState.data) setLikes(likeState.data.likes);
  }, [likeState.data?.likes]);

  const handleLikePost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!post || !userId || !likes || isLiking || pendingLikes > 0 || likeRequest.current) return;

    likeRequest.current = true;
    try {
      const updated = await likePost({
        postId: post.$id,
        userId,
        shouldLike: !likes.includes(userId),
      });
      setLikes(relationshipIds(updated.likes));
    } catch {
      toast({ title: "Couldn’t update your like. Try again." });
    } finally {
      likeRequest.current = false;
    }
  };

  const handleSavePost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!post || !canSave || isSavingPost || isDeletingSaved) return;

    try {
      if (savedPostRecord) {
        await deleteSavedPost(savedPostRecord.$id);
      } else {
        await savePost({ post, userId });
      }
    } catch {
      toast({ title: "Couldn’t update your saved posts. Try again." });
    }
  };

  const isLiked = !!likes && checkIsLiked(likes, userId);

  return (
    <div ref={ref} className="flex flex-wrap justify-between items-center gap-2 z-20">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={isLiked ? "Unlike post" : "Like post"}
          aria-pressed={isLiked}
          disabled={!likes || !post || !userId || isLiking || pendingLikes > 0}
          title={likes ? undefined : "Likes unavailable for this post"}
          onClick={handleLikePost}
          className="disabled:opacity-60"
        >
          <img
            src={isLiked ? "/assets/icons/liked.svg" : "/assets/icons/like.svg"}
            alt=""
            width={20}
            height={20}
          />
        </button>

        <p className="small-medium lg:base-medium">{likes?.length ?? "—"}</p>
        {likeState.isError && !likes && (
          <button
            type="button"
            className="small-regular text-light-3 underline"
            disabled={likeState.isFetching}
            onClick={() => void likeState.refetch()}
          >
            Retry likes
          </button>
        )}
      </div>
      {post && (
        <Link
          to={`/posts/${post.$id}#comments`}
          className="flex items-center gap-2 small-regular"
          aria-label={commentCount.data
            ? `View comments and replies (${commentCount.data.count})`
            : "View comments"}
          title={commentCount.isError && !commentCount.data ? "Comment count unavailable" : undefined}
        >
          <img src="/assets/icons/chat.svg" alt="" width={20} height={20} />
          <span>{commentCount.data?.count ?? "—"}</span>
          <span className="hidden sm:inline">{commentCount.data?.count === 1 ? "Comment" : "Comments"}</span>
        </Link>
      )}
      <div className="flex items-center gap-3">
        {post && <SharePostButton postId={post.$id} />}
        {isSavingPost || isDeletingSaved ? (
          <Loader />
        ) : (
          <button
            type="button"
            aria-label={isSaved ? "Unsave post" : "Save post"}
            aria-pressed={isSaved}
            disabled={!canSave}
            title={canSave ? undefined : "Saved posts unavailable"}
            onClick={handleSavePost}
            className="disabled:opacity-60"
          >
            <img
              src={isSaved ? "/assets/icons/saved.svg" : "/assets/icons/save.svg"}
              alt=""
              width={20}
              height={20}
            />
          </button>
        )}
      </div>
    </div>
  );
};

export default PostStats;
