import React, { useState, useEffect } from "react";
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

type PostStatsProps = {
  post?: Models.Document;
  userId: string;
};

const PostStats = ({ post, userId }: PostStatsProps) => {
  const [likes, setLikes] = useState(() => relationshipIds(post?.likes));
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
    setLikes(relationshipIds(post?.likes));
  }, [post?.$id, post?.likes]);

  const handleLikePost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!post || !userId || !likes || isLiking) return;

    try {
      const updated = await likePost({
        postId: post.$id,
        userId,
        shouldLike: !likes.includes(userId),
      });
      setLikes(relationshipIds(updated.likes));
    } catch {
      toast({ title: "Couldn’t update your like. Try again." });
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
    <div className="flex justify-between items-center z-20">
      <div className="flex gap-2 mr-5">
        <button
          type="button"
          aria-label={isLiked ? "Unlike post" : "Like post"}
          aria-pressed={isLiked}
          disabled={!likes || !post || !userId || isLiking}
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
      </div>
      <div className="flex gap-2">
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
