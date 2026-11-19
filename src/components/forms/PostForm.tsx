import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "../ui/textarea";
import FileUploader from "../shared/FileUploader";
import { CreatePostValidation, PostValidation } from "@/lib/validation";
import { Models } from "appwrite";
import {
  useCreatePost,
  useUpdatePost,
} from "@/lib/react-query/queriesAndMutations";
import { useUserContext } from "@/context/AuthContext";
import { Input } from "../ui/input";
import { useToast } from "../ui/use-toast";
import usePostDraft from "@/hooks/usePostDraft";
import { type PostSaveProgress } from "@/types";

type PostFormProps =
  | { action: "Create"; post?: never }
  | { action: "Update"; post: Models.Document };

type PostFormValues = z.infer<typeof PostValidation>;

const PostForm = ({ post, action }: PostFormProps) => {
  const { mutateAsync: createPost } = useCreatePost();
  const { mutateAsync: updatePost } = useUpdatePost();

  const { user } = useUserContext();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<PostSaveProgress>();
  const [submitError, setSubmitError] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const publishing = useRef(false);
  const mounted = useRef(true);

  const initialValues = useMemo(() => ({
    caption: post?.caption ?? "",
    file: [] as File[],
    location: post?.location ?? "",
    tags: Array.isArray(post?.tags) ? post.tags.join(",") : "",
  }), [post?.$id]);

  const form = useForm<PostFormValues>({
    resolver: zodResolver(
      action === "Create" ? CreatePostValidation : PostValidation
    ),
    defaultValues: initialValues,
  });

  const { isSubmitting } = form.formState;
  const draft = usePostDraft({ accountId: user.id, postId: post?.$id }, initialValues, form);
  const currentController = useRef(draft.controller);
  currentController.current = draft.controller;
  const inputsDisabled = isSubmitting || discarding || !draft.state.ready;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setProgress(undefined);
    setSubmitError("");
    setDiscarding(false);
  }, [draft.controller]);

  useEffect(() => {
    if (!isSubmitting && !draft.state.unsaved) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isSubmitting, draft.state.unsaved]);

  const retryDraft = async () => {
    if (draft.state.ready && draft.state.hasDraft) {
      await draft.controller.retrySaving();
    } else {
      const values = await draft.controller.restore();
      if (values && currentController.current === draft.controller) form.reset(values);
    }
  };

  const discardDraft = async () => {
    if (!window.confirm("Discard this draft and your current changes?")) return;
    setDiscarding(true);
    const values = await draft.controller.discard();
    if (mounted.current && currentController.current === draft.controller) {
      if (values) {
        form.reset(values);
        setSubmitError("");
      } else {
        toast({ variant: "destructive", title: "Couldn’t discard the draft. Try again." });
      }
      setDiscarding(false);
    }
  };

  const cancel = async () => {
    if (inputsDisabled) return;
    const saved = await draft.controller.flush();
    if (!saved && draft.state.hasDraft &&
      !window.confirm("Your draft could not be saved. Leave this page anyway?")) {
      return;
    }
    navigate(-1);
  };

  async function onSubmit(values: PostFormValues) {
    if (publishing.current || inputsDisabled || !user.id) return;
    publishing.current = true;
    setSubmitError("");
    const controller = draft.controller;
    const isCurrent = () => mounted.current && currentController.current === controller;
    controller.change(values);
    try {
      await controller.flush();
      if (!isCurrent()) return;
      const onProgress = (next: PostSaveProgress) => {
        if (isCurrent()) setProgress(next);
      };
      let destination = "/";
      if (action === "Update") {
        const updatedPost = await updatePost({
          ...values,
          postId: post.$id,
          imageId: post.imageId,
          imageUrl: post.imageUrl,
          onProgress,
        });

        if (!updatedPost) throw new Error("Post update failed");

        destination = `/posts/${post.$id}`;
      } else {
        const newPost = await createPost({
          ...values,
          userId: user.id,
          onProgress,
        });
        if (!newPost) throw new Error("Post creation failed");
      }
      if (!isCurrent()) return;
      const cleared = await controller.finish();
      if (!isCurrent()) return;
      if (!cleared) {
        toast({
          title: "Your post was saved",
          description: "The local draft could not be removed from this device.",
        });
      }
      navigate(destination);
    } catch {
      if (isCurrent()) {
        setSubmitError(
          action === "Create"
            ? "Couldn’t publish your post. Your changes are still here. Try again."
            : "Couldn’t save your changes. Try again."
        );
      }
    } finally {
      publishing.current = false;
      if (isCurrent()) setProgress(undefined);
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-9 w-full max-w-5xl"
      >
        <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-dark-4 bg-dark-2 p-4">
          <div className="flex-1">
            <p className="small-regular text-light-3" role={draft.state.status === "error" ? "alert" : "status"}>
              {draft.state.status === "loading"
                ? "Loading your draft…"
                : draft.state.status === "saving"
                  ? "Saving draft…"
                  : draft.state.status === "saved"
                    ? draft.state.restored ? "Draft restored from this device" : "Draft saved on this device"
                    : draft.state.status === "error"
                      ? draft.state.ready
                        ? "Your draft could not be saved on this device. Keep this page open or retry."
                        : "Your local draft could not be restored. Retry or continue without saving."
                      : "Drafts save automatically on this device."}
            </p>
          </div>
          {draft.state.status === "error" && (
            <>
              <Button type="button" variant="ghost" size="sm" disabled={isSubmitting || discarding} onClick={() => void retryDraft()}>
                Retry
              </Button>
              {!draft.state.ready && (
                <Button type="button" variant="ghost" size="sm" onClick={() => draft.controller.continueWithoutSaving()}>
                  Continue without saving
                </Button>
              )}
            </>
          )}
          {(draft.state.hasDraft || (!draft.state.ready && draft.state.status === "error")) && (
            <Button type="button" variant="ghost" size="sm" disabled={isSubmitting || discarding} onClick={() => void discardDraft()}>
              {discarding ? "Discarding…" : "Discard draft"}
            </Button>
          )}
        </div>
        <fieldset
          disabled={inputsDisabled}
          className={draft.state.ready ? "flex min-w-0 w-full flex-col gap-9" : "hidden"}
        >
        <FormField
          control={form.control}
          name="caption"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="shad-form_label">Caption</FormLabel>
              <FormControl>
                <Textarea
                  className="shad-textarea custom-scrollbar"
                  {...field}
                />
              </FormControl>
              <FormMessage className="shad-form_message" />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="file"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="shad-form_label">Photo</FormLabel>
              <FormControl>
                <FileUploader
                  fieldChange={field.onChange}
                  mediaUrl={post?.imageUrl}
                  files={field.value}
                  disabled={inputsDisabled}
                />
              </FormControl>
              <FormMessage className="shad-form_message" />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="shad-form_label">Add Location</FormLabel>
              <FormControl>
                <Input type="text" className="shad-input" {...field} />
              </FormControl>
              <FormMessage className="shad-form_message" />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="tags"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="shad-form_label">
                Add Tags (separated by comma " , ")
              </FormLabel>
              <FormControl>
                <Input
                  type="text"
                  className="shad-input"
                  placeholder="Art, Expression, Learn"
                  {...field}
                />
              </FormControl>
              <FormMessage className="shad-form_message" />
            </FormItem>
          )}
        />
        {progress && (
          <div className="flex w-full flex-col gap-2" role="status">
            <p className="small-medium text-light-2">
              {progress.phase === "saving"
                ? "Finishing your post…"
                : progress.percent === undefined
                  ? "Uploading photo…"
                  : `Uploading photo ${Math.floor(progress.percent)}%`}
            </p>
            <progress
              aria-label={progress.phase === "saving" ? "Saving post" : "Photo upload progress"}
              max={100}
              value={progress.phase === "uploading" ? progress.percent : undefined}
              className="w-full accent-[#877eff]"
            />
          </div>
        )}
        {submitError && <p role="alert" className="small-regular text-red-400">{submitError}</p>}
        <div className="flex gap-4 items-center justify-end">
          <Button
            type="button"
            className="shad-button_dark_4"
            disabled={inputsDisabled}
            onClick={() => void cancel()}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="shad-button_primary whitespace-nowrap"
            disabled={inputsDisabled}
          >
            {isSubmitting ? "Saving..." : `${action} Post`}
          </Button>
        </div>
        </fieldset>
      </form>
    </Form>
  );
};

export default PostForm;
