import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import Loader from "@/components/shared/Loader";
import { useToast } from "@/components/ui/use-toast";
import { useUserContext } from "@/context/AuthContext";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/lib/react-query/social";
import { cn, multiFormatDateString } from "@/lib/utils";

const activity = {
  follow: "started following you.",
  like: "liked your post.",
  comment: "commented on your post.",
  reply: "replied to your comment.",
};

const Notifications = () => {
  const { isAuthenticated, isLoading: isAuthLoading } = useUserContext();
  const { toast } = useToast();
  const query = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const notifications = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.notifications) ?? [])
        .map((notification) => [notification.$id, notification])
    ).values(),
  ];

  const markNotification = (id: string, read: boolean) => {
    if (read) return;
    void markRead.mutateAsync(id).catch(() => {
      toast({
        variant: "destructive",
        title: "Could not mark the notification as read",
        description: "Please try again.",
      });
    });
  };

  const markEveryNotification = async () => {
    try {
      await markAllRead.mutateAsync();
    } catch {
      toast({
        variant: "destructive",
        title: "Could not mark notifications as read",
        description: "Please try again.",
      });
    }
  };

  return (
    <div className="common-container min-w-0">
      <div className="flex w-full max-w-3xl flex-wrap items-center justify-between gap-4">
        <h1 className="h3-bold md:h2-bold">Notifications</h1>
        {isAuthenticated && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="gap-2 text-light-2"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw aria-hidden="true" size={16} />
              Refresh
            </Button>
            {notifications.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                className="gap-2 text-light-2"
                disabled={markAllRead.isPending}
                onClick={() => void markEveryNotification()}
              >
                <CheckCheck aria-hidden="true" size={18} />
                {markAllRead.isPending ? "Marking as read…" : "Mark all as read"}
              </Button>
            )}
          </div>
        )}
      </div>

      {isAuthLoading || query.isLoading ? (
        <Loader />
      ) : !isAuthenticated ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <p>Log in to view your notifications.</p>
          <Link to="/sign-in" className="text-primary-500 underline">
            Log in
          </Link>
        </div>
      ) : !query.data ? (
        <div className="flex flex-col items-center gap-4 text-center" role="status">
          <p>Could not load notifications.</p>
          <Button
            className="shad-button_dark_4"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? "Loading…" : "Try again"}
          </Button>
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <Bell aria-hidden="true" size={36} className="text-light-3" />
          <p className="text-light-2">You’re all caught up.</p>
          <p className="small-regular max-w-xs text-light-3">
            New follows, likes, comments and replies will appear here.
          </p>
        </div>
      ) : (
        <ul className="flex w-full max-w-3xl flex-col gap-3">
          {notifications.map((notification) => {
            const actor = notification.actor;
            const name = actor?.name || actor?.username || "A ZeroNet member";
            const actorPath = actor ? `/profile/${actor.$id}` : null;
            const postPath = notification.postId
              ? `/posts/${encodeURIComponent(notification.postId)}${
                  notification.commentId
                    ? `?comment=${encodeURIComponent(notification.commentId)}#comments`
                    : ""
                }`
              : null;
            const destination = notification.type === "follow" ? actorPath : postPath;
            const readNotification = () =>
              markNotification(notification.$id, notification.read);
            const avatar = (
              <img
                src={actor?.imageUrl || "/assets/icons/profile-placeholder.svg"}
                alt=""
                className="h-11 w-11 rounded-full object-cover"
                loading="lazy"
              />
            );

            return (
              <li
                key={notification.$id}
                className={cn(
                  "flex items-start gap-3 rounded-2xl border p-4 sm:gap-4 sm:p-5",
                  notification.read
                    ? "border-dark-4 bg-dark-2"
                    : "border-primary-500/40 bg-dark-3"
                )}
              >
                {actorPath ? (
                  <Link
                    to={actorPath}
                    aria-label={`View ${name}’s profile`}
                    onClick={readNotification}
                    className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    {avatar}
                  </Link>
                ) : (
                  <div className="shrink-0">{avatar}</div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="small-medium sm:base-medium">
                    {actorPath ? (
                      <Link
                        to={actorPath}
                        onClick={readNotification}
                        className="font-semibold hover:underline"
                      >
                        {name}
                      </Link>
                    ) : name}
                  </p>
                  {destination ? (
                    <Link
                      to={destination}
                      onClick={readNotification}
                      className="small-regular mt-1 block py-1 text-light-2 hover:underline sm:base-regular"
                    >
                      {activity[notification.type]}
                    </Link>
                  ) : (
                    <p className="small-regular mt-1 py-1 text-light-2">
                      {activity[notification.type]}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <time
                      dateTime={notification.$createdAt}
                      className="subtle-semibold text-light-3"
                    >
                      {multiFormatDateString(notification.$createdAt)}
                    </time>
                    {!notification.read && (
                      <button
                        type="button"
                        className="subtle-semibold text-primary-500 hover:underline disabled:opacity-50"
                        disabled={markRead.isPending || markAllRead.isPending}
                        onClick={readNotification}
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                </div>
                {!notification.read && (
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary-500">
                    <span className="sr-only">Unread</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {query.isError && query.data && (
        <p role="status" className="small-regular text-light-3">
          Could not refresh notifications. Your previous notifications are shown.
        </p>
      )}
      {query.hasNextPage && (
        <Button
          className="shad-button_dark_4"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage
            ? "Loading…"
            : query.isError ? "Retry loading more" : "Load more"}
        </Button>
      )}
    </div>
  );
};

export default Notifications;
