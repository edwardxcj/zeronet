import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AppwriteException } from "appwrite";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useUserContext } from "@/context/AuthContext";
import { type Comment } from "@/lib/appwrite/social";
import {
  useComment,
  useCommentCount,
  useComments,
  useCreateComment,
  useDeleteComment,
} from "@/lib/react-query/social";
import { multiFormatDateString } from "@/lib/utils";
import Loader from "./Loader";

function RequestError({
  message,
  busy,
  onRetry,
}: {
  message: string;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert" className="small-regular text-light-3">{message}</p>
      <Button type="button" variant="ghost" disabled={busy} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function CommentCard({
  comment,
  targetId,
  onReply,
  replyTo,
}: {
  comment: Comment;
  targetId?: string;
  onReply: (comment: Comment) => void;
  replyTo?: string;
}) {
  const deletion = useDeleteComment(comment.postId);
  const inFlight = useRef(false);
  const card = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  const selected = targetId === comment.$id;
  const name = comment.author?.name || comment.author?.username || "Unknown author";

  useEffect(() => {
    if (selected) {
      card.current?.scrollIntoView({ block: "center" });
      card.current?.focus({ preventScroll: true });
    }
  }, [selected]);

  const handleDelete = async () => {
    if (inFlight.current || !comment.canDelete || comment.deleted) return;
    if (!window.confirm("Delete this comment? Replies will stay visible.")) return;
    inFlight.current = true;
    setError("");
    try {
      await deletion.mutateAsync(comment.$id);
    } catch {
      setError("Couldn’t delete this comment. Try again.");
    } finally {
      inFlight.current = false;
    }
  };

  const author = (
    <>
      <img
        src={comment.author?.imageUrl || "/assets/icons/profile-placeholder.svg"}
        alt=""
        width={32}
        height={32}
        className="h-8 w-8 rounded-full object-cover"
        loading="lazy"
      />
      <span className="small-semibold break-words">{name}</span>
    </>
  );

  return (
    <article
      ref={card}
      id={`comment-${comment.$id}`}
      tabIndex={selected ? -1 : undefined}
      className={`min-w-0 rounded-xl border p-4 ${
        selected ? "border-primary-500 bg-dark-3" : "border-dark-4 bg-dark-2"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {comment.author ? (
          <Link to={`/profile/${comment.author.$id}`} className="flex min-w-0 items-center gap-2">
            {author}
          </Link>
        ) : (
          <div className="flex min-w-0 items-center gap-2">{author}</div>
        )}
        <time dateTime={comment.$createdAt} className="subtle-semibold text-light-3">
          {multiFormatDateString(comment.$createdAt)}
        </time>
      </div>
      {replyTo && (
        <p className="mt-2 small-regular text-light-3">In reply to {replyTo}</p>
      )}
      <p className="mt-3 whitespace-pre-wrap break-words small-regular text-light-2">
        {comment.deleted ? "This comment was deleted." : comment.content}
      </p>
      {!comment.deleted && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={deletion.isPending}
            onClick={() => onReply(comment)}
          >
            Reply
          </Button>
          {comment.canDelete && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={deletion.isPending}
              aria-label={`Delete comment by ${name}`}
              onClick={handleDelete}
            >
              {deletion.isPending ? "Deleting…" : "Delete"}
            </Button>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 small-regular text-light-3">{error}</p>}
    </article>
  );
}

function CommentThread({
  comment,
  target,
  onReply,
}: {
  comment: Comment;
  target?: Comment;
  onReply: (comment: Comment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const targetReply = target?.rootId === comment.$id ? target : undefined;
  const replies = useComments(comment.postId, comment.$id, expanded);
  const loadedReplies = replies.data?.pages.flatMap((page) => page.comments) ?? [];
  const comments = [...new Map(loadedReplies.map((reply) => [reply.$id, reply])).values()];
  const targetLoaded = comments.some((reply) => reply.$id === targetReply?.$id);

  useEffect(() => {
    if (targetReply) setExpanded(true);
  }, [targetReply?.$id]);

  useEffect(() => {
    if (
      expanded &&
      targetReply &&
      !targetLoaded &&
      replies.hasNextPage &&
      replies.fetchStatus === "idle" &&
      !replies.isError
    ) {
      void replies.fetchNextPage({ cancelRefetch: false });
    }
  }, [
    expanded,
    targetReply?.$id,
    targetLoaded,
    replies.hasNextPage,
    replies.fetchStatus,
    replies.isError,
    replies.fetchNextPage,
  ]);

  const replyRegion = useId();
  return (
    <li className="min-w-0">
      <CommentCard comment={comment} targetId={target?.$id} onReply={onReply} />
      {(comment.replyCount > 0 || targetReply || expanded) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 text-primary-500"
          aria-expanded={expanded}
          aria-controls={replyRegion}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide replies" : `View replies (${comment.replyCount})`}
        </Button>
      )}
      {expanded && (
        <div id={replyRegion} className="mt-2 border-l border-dark-4 pl-3 sm:pl-6">
          {replies.isLoading ? (
            <Loader />
          ) : (
            <>
              <ol className="flex flex-col gap-3">
                {comments.map((reply) => (
                  <li key={reply.$id}>
                    <CommentCard
                      comment={reply}
                      targetId={target?.$id}
                      onReply={onReply}
                      replyTo={reply.parentId && reply.parentId !== comment.$id
                        ? comments.find((parent) => parent.$id === reply.parentId)?.author?.name || "an earlier reply"
                        : undefined}
                    />
                  </li>
                ))}
              </ol>
              {replies.isError ? (
                <RequestError
                  message="Couldn’t load replies."
                  busy={replies.isFetching}
                  onRetry={() => void replies.refetch()}
                />
              ) : replies.isPaused ? (
                <p role="status" className="small-regular text-light-3">
                  Reconnect to load replies.
                </p>
              ) : replies.hasNextPage ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-3"
                  disabled={replies.isFetching}
                  onClick={() => void replies.fetchNextPage({ cancelRefetch: false })}
                >
                  {replies.isFetchingNextPage ? "Loading…" : "Load more replies"}
                </Button>
              ) : comments.length === 0 ? (
                <p className="small-regular text-light-3">No replies yet.</p>
              ) : null}
            </>
          )}
        </div>
      )}
    </li>
  );
}

const Comments = ({ postId }: { postId: string }) => {
  const { user, isAuthenticated } = useUserContext();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const targetId = params.get("comment") || undefined;
  const target = useComment(postId, targetId);
  const root = useComment(postId, target.data?.rootId ?? undefined);
  const linkedRoot = target.data?.rootId ? root.data : target.data;
  const comments = useComments(postId);
  const commentCount = useCommentCount(postId);
  const creation = useCreateComment(postId);
  const [content, setContent] = useState("");
  const [replyTarget, setReplyTarget] = useState<Comment>();
  const [submitError, setSubmitError] = useState("");
  const submission = useRef<{ requestId: string; content: string; parentId?: string }>();
  const posting = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const section = useRef<HTMLElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (hash === "#comments" && !targetId) {
      section.current?.scrollIntoView({ block: "start" });
    }
  }, [hash, postId, targetId]);

  const loaded = comments.data?.pages.flatMap((page) => page.comments) ?? [];
  const roots = [...new Map(loaded.map((comment) => [comment.$id, comment])).values()];
  if (linkedRoot && !roots.some((comment) => comment.$id === linkedRoot.$id)) {
    roots.unshift(linkedRoot);
  }

  const startReply = (comment: Comment) => {
    setReplyTarget(comment);
    textarea.current?.focus();
    textarea.current?.scrollIntoView({ block: "center" });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = content.trim();
    if (posting.current || !text || text.length > 2000) return;
    posting.current = true;
    setSubmitError("");
    if (
      !submission.current ||
      submission.current.content !== text ||
      submission.current.parentId !== replyTarget?.$id
    ) {
      submission.current = {
        requestId: crypto.randomUUID(),
        content: text,
        parentId: replyTarget?.$id,
      };
    }
    try {
      const comment = await creation.mutateAsync(submission.current);
      setContent("");
      setReplyTarget(undefined);
      submission.current = undefined;
      const search = new URLSearchParams(params);
      search.set("comment", comment.$id);
      navigate({ search: search.toString(), hash: "#comments" }, { replace: true });
    } catch (error) {
      setSubmitError(
        error instanceof AppwriteException && error.code === 400
          ? error.message
          : "Couldn’t post your comment. Your text is still here. Try again."
      );
    } finally {
      posting.current = false;
    }
  };

  return (
    <section ref={section} id="comments" aria-labelledby="comments-title" className="w-full max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h3 id="comments-title" className="body-bold md:h3-bold">
          Comments <span className="text-light-3">({commentCount.data?.count ?? "—"})</span>
        </h3>
        {commentCount.isError && !commentCount.data && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={commentCount.isFetching}
            onClick={() => void commentCount.refetch()}
          >
            Retry comment count
          </Button>
        )}
      </div>
      {isAuthenticated && user.id ? (
        <form onSubmit={handleSubmit} className="mb-8 flex flex-col gap-3">
          {replyTarget && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="small-regular text-light-3">
                Replying to {replyTarget.author?.name || "Unknown author"}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={creation.isPending}
                onClick={() => setReplyTarget(undefined)}
              >
                Cancel reply
              </Button>
            </div>
          )}
          <label htmlFor={inputId} className="small-medium">
            {replyTarget ? "Your reply" : "Add a comment"}
          </label>
          <Textarea
            ref={textarea}
            id={inputId}
            value={content}
            maxLength={2000}
            disabled={creation.isPending}
            aria-describedby={`${inputId}-limit`}
            className="shad-textarea"
            onChange={(event) => setContent(event.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <span id={`${inputId}-limit`} className="small-regular text-light-3">
              {content.length}/2000
            </span>
            <Button
              type="submit"
              className="shad-button_primary"
              disabled={creation.isPending || !content.trim()}
            >
              {creation.isPending ? "Posting…" : replyTarget ? "Post reply" : "Post comment"}
            </Button>
          </div>
          {submitError && <p role="alert" className="small-regular text-light-3">{submitError}</p>}
        </form>
      ) : (
        <p className="mb-6 small-regular text-light-3">
          <Link to="/sign-in" className="text-primary-500 underline">Sign in</Link> to join the discussion.
        </p>
      )}

      {targetId && (target.isLoading || root.isLoading) && (
        <p role="status" className="mb-4 small-regular text-light-3">Loading the linked comment…</p>
      )}
      {targetId && (target.isError || root.isError) && (
        <RequestError
          message="Couldn’t load the linked comment."
          busy={target.isFetching || root.isFetching}
          onRetry={() => void (target.isError ? target.refetch() : root.refetch())}
        />
      )}

      <ol className="flex flex-col gap-5">
        {roots.map((comment) => (
          <CommentThread key={comment.$id} comment={comment} target={target.data} onReply={startReply} />
        ))}
      </ol>
      {comments.isLoading ? (
        <Loader />
      ) : comments.isError ? (
        <RequestError
          message="Couldn’t load comments."
          busy={comments.isFetching}
          onRetry={() => void comments.refetch()}
        />
      ) : comments.isPaused ? (
        <p role="status" className="small-regular text-light-3">Reconnect to load comments.</p>
      ) : comments.data && roots.length === 0 ? (
        <p className="small-regular text-light-3">No comments yet. Start the conversation.</p>
      ) : null}
      {comments.hasNextPage && !comments.isError && (
        <Button
          type="button"
          className="shad-button_dark_4 mt-5"
          disabled={comments.isFetching}
          onClick={() => void comments.fetchNextPage({ cancelRefetch: false })}
        >
          {comments.isFetchingNextPage ? "Loading…" : "Load more comments"}
        </Button>
      )}
    </section>
  );
};

export default Comments;
