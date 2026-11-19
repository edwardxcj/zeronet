const productionOrigin = "https://zeronet.vercel.app";

export function postShareUrl(postId: string) {
  if (!postId.trim()) throw new Error("A post is required to share.");
  return `${productionOrigin}/posts/${encodeURIComponent(postId)}`;
}

export type ShareResult = "shared" | "copied" | "cancelled" | "manual";

type ShareServices = {
  share?: (data: ShareData) => Promise<void>;
  copy?: (text: string) => Promise<void>;
};

export async function sharePostLink(url: string, services: ShareServices): Promise<ShareResult> {
  if (services.share) {
    try {
      await services.share({ title: "ZeroNet", url });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }
  if (services.copy) {
    try {
      await services.copy(url);
      return "copied";
    } catch {
      // The dialog lets people copy the link when browser access is unavailable.
    }
  }
  return "manual";
}
