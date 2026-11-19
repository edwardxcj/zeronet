import { useEffect, useId, useRef, useState } from "react";
import { Copy, Share2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { postShareUrl, sharePostLink } from "@/lib/share";

const SharePostButton = ({ postId }: { postId: string }) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const inputId = useId();
  const url = postShareUrl(postId);

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
      input.current?.select();
    }
  }, [open]);

  const share = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await sharePostLink(url, {
        share: typeof navigator.share === "function" ? navigator.share.bind(navigator) : undefined,
        copy: navigator.clipboard?.writeText.bind(navigator.clipboard),
      });
      if (result === "copied") toast({ title: "Post link copied" });
      if (result === "manual") {
        setCopyError(false);
        setOpen(true);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const copy = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await sharePostLink(url, { copy: navigator.clipboard?.writeText.bind(navigator.clipboard) });
      if (result === "copied") {
        toast({ title: "Post link copied" });
        dialog.current?.close();
      } else {
        setCopyError(true);
        input.current?.focus();
        input.current?.select();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Share post"
        title="Share post"
        disabled={busy}
        onClick={(event) => { event.stopPropagation(); void share(); }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary-500 transition-colors hover:bg-dark-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
      >
        <Share2 size={20} aria-hidden="true" />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={headingId}
        onClose={() => setOpen(false)}
        className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-2xl border border-dark-4 bg-dark-2 p-6 text-white shadow-2xl backdrop:bg-black/75"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id={headingId} className="body-bold">Share post</h2>
          <Button type="button" variant="ghost" size="icon" aria-label="Close share dialog" onClick={() => dialog.current?.close()}>
            <X size={20} aria-hidden="true" />
          </Button>
        </div>
        <p className="mt-2 small-regular text-light-3">Copy the link to share this post.</p>
        <label htmlFor={inputId} className="mt-5 block small-medium">Post link</label>
        <input
          ref={input}
          id={inputId}
          type="url"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => event.currentTarget.select()}
          className="shad-input mt-2 h-12 w-full rounded-lg border border-dark-4 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        />
        {copyError && <p role="status" className="mt-3 small-regular text-light-3">Select and copy the link above using your device’s copy command.</p>}
        <Button type="button" className="shad-button_primary mt-5 w-full gap-2" disabled={busy} onClick={() => void copy()}>
          <Copy size={16} aria-hidden="true" /> Copy link
        </Button>
      </dialog>
    </>
  );
};

export default SharePostButton;
