import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useGetConnections, useGetFollow } from "@/lib/react-query/follows";
import type { ConnectionDirection, ConnectionProfile } from "@/lib/appwrite/follows";
import FollowButton from "./FollowButton";
import Loader from "./Loader";

function ConnectionRow({
  profile,
  onNavigate,
}: {
  profile: ConnectionProfile;
  onNavigate: () => void;
}) {
  const follow = useGetFollow(profile.$id);

  return (
    <li className="flex items-center gap-3 py-3">
      <Link
        to={`/profile/${profile.$id}`}
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
      >
        <img
          src={profile.imageUrl || "/assets/icons/profile-placeholder.svg"}
          alt=""
          className="h-11 w-11 shrink-0 rounded-full object-cover"
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{profile.name}</span>
          <span className="block truncate text-sm text-light-3">@{profile.username}</span>
        </span>
      </Link>
      <FollowButton
        targetId={profile.$id}
        status={follow}
        size="sm"
        className="shrink-0 px-3"
      />
    </li>
  );
}

const FollowList = ({
  targetId,
  direction,
  onClose,
}: {
  targetId: string;
  direction: ConnectionDirection;
  onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useGetConnections(targetId, direction);
  const profiles = list.data?.pages.flatMap((page) => page.profiles) ?? [];
  const uniqueProfiles = [...new Map(profiles.map((profile) => [profile.$id, profile])).values()];
  const title = direction === "followers" ? "Followers" : "Following";

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby="connections-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto w-[calc(100%-32px)] max-w-lg rounded-2xl border border-dark-4 bg-dark-2 p-0 text-light-1 shadow-2xl backdrop:bg-black/75"
    >
      <div className="flex max-h-[80dvh] flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-dark-4 px-5 py-4">
          <h2 id="connections-title" className="text-lg font-semibold">{title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Close list"
            autoFocus
            onClick={onClose}
          >
            Close
          </Button>
        </header>
        <div className="custom-scrollbar min-h-[120px] overflow-y-auto px-5 py-2">
          {list.isPending ? (
            <div className="flex-center py-8"><Loader /></div>
          ) : (
            <>
              {uniqueProfiles.length > 0 ? (
                <ul className="divide-y divide-dark-4">
                  {uniqueProfiles.map((profile) => (
                    <ConnectionRow key={profile.$id} profile={profile} onNavigate={onClose} />
                  ))}
                </ul>
              ) : !list.isError && (
                <p className="py-8 text-center text-sm text-light-3">
                  {direction === "followers" ? "No followers yet." : "No accounts followed yet."}
                </p>
              )}
              {list.isError ? (
                <div className="flex-center flex-col gap-3 py-5">
                  <p role="alert" className="text-center text-sm text-light-3">
                    Could not load the list.
                  </p>
                  <Button
                    type="button"
                    className="shad-button_dark_4"
                    disabled={list.isFetching}
                    onClick={() => void list.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              ) : list.hasNextPage && (
                <div className="flex-center py-4">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={list.isFetching}
                    onClick={() => void list.fetchNextPage()}
                  >
                    {list.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </dialog>,
    document.body
  );
};

export default FollowList;
