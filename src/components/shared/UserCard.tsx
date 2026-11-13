import { Models } from "appwrite";
import { Link } from "react-router-dom";
import { useInView } from "react-intersection-observer";

import { useGetFollow } from "@/lib/react-query/follows";
import FollowButton from "./FollowButton";

type UserCardProps = {
  user: Models.Document;
};

const UserCard = ({ user }: UserCardProps) => {
  const { ref, inView } = useInView({
    rootMargin: "120px",
    triggerOnce: true,
    fallbackInView: true,
  });
  const follow = useGetFollow(user.$id, false, inView);

  return (
    <article ref={ref} className="user-card">
      <Link to={`/profile/${user.$id}`} className="flex-center w-full flex-col gap-4">
        <img
          src={user.imageUrl || "/assets/icons/profile-placeholder.svg"}
          alt=""
          className="rounded-full w-14 h-14"
        />

        <div className="flex-center flex-col gap-1">
          <p className="base-medium text-light-1 text-center line-clamp-1">
            {user.name}
          </p>
          <p className="small-regular text-light-3 text-center line-clamp-1">
            @{user.username}
          </p>
        </div>
      </Link>

      <FollowButton targetId={user.$id} status={follow} size="sm" className="px-5" />
    </article>
  );
};

export default UserCard;
