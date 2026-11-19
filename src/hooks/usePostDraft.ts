import { useEffect, useMemo, useSyncExternalStore } from "react";
import { type UseFormReturn } from "react-hook-form";

import { PostDraftController, type PostDraftScope, type PostDraftValues } from "@/lib/postDrafts";

export default function usePostDraft(
  scope: PostDraftScope,
  initialValues: PostDraftValues,
  form: UseFormReturn<PostDraftValues>
) {
  // Reopening a different post/account creates a separate persistence lifecycle.
  // Refetching the same post must not replace the user's current input.
  const controller = useMemo(
    () => new PostDraftController(scope, initialValues),
    [scope.accountId, scope.postId]
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    if (!scope.accountId) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    form.reset(initialValues);
    void controller.restore().then((values) => {
      if (!active) return;
      if (values) form.reset(values);
      const subscription = form.watch(() => controller.change(form.getValues()));
      unsubscribe = () => subscription.unsubscribe();
    });
    return () => {
      active = false;
      unsubscribe?.();
      controller.dispose();
    };
  }, [controller, form]);

  return { state, controller };
}
