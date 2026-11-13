import { Button, type ButtonProps } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useUserContext } from "@/context/AuthContext";
import { useGetFollow, useSetFollow } from "@/lib/react-query/follows";
import { cn } from "@/lib/utils";

type FollowButtonProps = Pick<ButtonProps, "className" | "size"> & {
  targetId: string;
  status: ReturnType<typeof useGetFollow>;
};

const FollowButton = ({ targetId, status, size, className }: FollowButtonProps) => {
  const { user, isAuthenticated } = useUserContext();
  const { toast } = useToast();
  const { isPending, setFollowing } = useSetFollow(targetId);

  if (!isAuthenticated || !user.id || !targetId || targetId === user.id) {
    return null;
  }

  const following = status.data?.following;
  const shouldRetry = following === undefined && status.isError;

  const handleClick = () => {
    if (shouldRetry) {
      void status.refetch();
      return;
    }
    if (following === undefined) return;

    setFollowing(!following, () =>
      toast({
        variant: "destructive",
        title: "Couldn’t update follow status",
        description: "Please try again.",
      })
    );
  };

  return (
    <Button
      type="button"
      size={size}
      variant={following ? "outline" : "default"}
      className={cn(following ? "text-light-1" : "shad-button_primary", className)}
      disabled={isPending || (following === undefined && (!shouldRetry || status.isFetching))}
      aria-busy={isPending || status.isFetching}
      aria-label={shouldRetry ? "Retry loading follow status" : undefined}
      onClick={handleClick}
    >
      {shouldRetry ? "Retry" : following ? "Unfollow" : "Follow"}
    </Button>
  );
};

export default FollowButton;
