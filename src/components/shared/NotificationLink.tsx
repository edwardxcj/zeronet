import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { NavLink } from "react-router-dom";

import { useUserContext } from "@/context/AuthContext";
import { useUnreadNotificationCount } from "@/lib/react-query/social";
import { cn } from "@/lib/utils";

type NotificationLinkProps = {
  compact?: boolean;
};

const NotificationLink = ({ compact = false }: NotificationLinkProps) => {
  const { isAuthenticated } = useUserContext();
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");

  useEffect(() => {
    const updateVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const unread = useUnreadNotificationCount({
    enabled: visible,
    refetchInterval: visible ? 20_000 : false,
  });
  const count = unread.data?.count;
  const label = count ? `Notifications, ${count} unread` : "Notifications";

  if (!isAuthenticated) return null;

  return (
    <NavLink
      to="/notifications"
      aria-label={label}
      title={compact ? label : undefined}
      className={({ isActive }) =>
        cn(
          "relative flex items-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
          compact ? "h-10 w-10 justify-center" : "gap-4 p-4",
          isActive ? "bg-primary-500 text-dark-1" : "hover:bg-dark-4"
        )
      }
    >
      <Bell aria-hidden="true" size={24} className="shrink-0" />
      {!compact && <span>Notifications</span>}
      {count !== undefined && count > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            "flex min-w-[20px] items-center justify-center rounded-full bg-red px-1.5 text-[11px] font-semibold leading-5 text-dark-1",
            compact ? "absolute -right-1 -top-1" : "ml-auto"
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </NavLink>
  );
};

export default NotificationLink;
