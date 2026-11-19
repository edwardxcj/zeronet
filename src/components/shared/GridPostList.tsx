import { Link } from "react-router-dom";

import PostStats from "./PostStats";
import { useUserContext } from "@/context/AuthContext";
import { relationshipDocuments } from "@/lib/appwrite/relationships";

type GridPostListProps = {
  posts?: unknown;
  showUser?: boolean;
  showStats?: boolean;
};

const GridPostList = ({
  posts,
  showUser = true,
  showStats = true,
}: GridPostListProps) => {
  const { user } = useUserContext();

  return (
    <ul className="grid-container">
      {relationshipDocuments(posts).map((post) => (
        <li key={post.$id} className="relative min-w-0 h-80">
          <Link to={`/posts/${post.$id}`} className="grid-post_link">
            <img
              src={post.imageUrl}
              alt="post"
              className="h-full w-full object-cover"
            />
          </Link>

          <div className="grid-post_user">
            {showUser && (
              <div className="flex w-full min-w-0 items-center gap-2.5">
                <img
                  src={
                    post.creator?.imageUrl ||
                    "/assets/icons/profile-placeholder.svg"
                  }
                  alt="creator"
                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                />
                <p className="min-w-0 flex-1 break-words text-sm font-medium leading-snug [overflow-wrap:anywhere]">
                  {post.creator?.name || "Unknown creator"}
                </p>
              </div>
            )}
            {showStats && <PostStats post={post} userId={user.id} compact />}
          </div>
        </li>
      ))}
    </ul>
  );
};

export default GridPostList;
