export type HomeFeed = "all" | "following";

export type HomeScrollPosition = {
  top: number;
  pages: number;
  anchorId?: string;
  anchorOffset?: number;
};

type HomeView = {
  feed: HomeFeed;
  positions: Record<HomeFeed, HomeScrollPosition>;
};

// Navigation state only; no post content or account credentials are persisted.
const views = new Map<string, HomeView>();
const initialView = (): HomeView => ({
  feed: "all",
  positions: { all: { top: 0, pages: 1 }, following: { top: 0, pages: 1 } },
});

export function readHomeView(viewerId: string): HomeView {
  const view = views.get(viewerId) ?? initialView();
  return { feed: view.feed, positions: { all: { ...view.positions.all }, following: { ...view.positions.following } } };
}

export function rememberHomeFeed(viewerId: string, feed: HomeFeed) {
  views.set(viewerId, { ...readHomeView(viewerId), feed });
}

export function rememberHomeScroll(viewerId: string, feed: HomeFeed, position: HomeScrollPosition) {
  const view = readHomeView(viewerId);
  view.positions[feed] = { ...position };
  views.set(viewerId, view);
}

export function uniqueFeedPosts<T extends { $id: string }>(pages: readonly { documents: readonly T[] }[] | undefined): T[] {
  const seen = new Set<string>();
  return (pages?.flatMap((page) => page.documents) ?? []).filter((post) => {
    if (seen.has(post.$id)) return false;
    seen.add(post.$id);
    return true;
  });
}

export function captureHomeScroll(container: HTMLElement, pages: number): HomeScrollPosition {
  const viewport = container.getBoundingClientRect();
  const anchor = Array.from(container.querySelectorAll<HTMLElement>("[data-home-post]"))
    .find((post) => post.getBoundingClientRect().bottom > viewport.top);
  return {
    top: container.scrollTop,
    pages: Math.max(1, pages),
    ...(anchor ? { anchorId: anchor.dataset.homePost, anchorOffset: anchor.getBoundingClientRect().top - viewport.top } : {}),
  };
}

export function restoreHomeScroll(container: HTMLElement, position: HomeScrollPosition) {
  const anchor = position.anchorId
    ? Array.from(container.querySelectorAll<HTMLElement>("[data-home-post]"))
      .find((post) => post.dataset.homePost === position.anchorId)
    : undefined;
  if (anchor && position.anchorOffset !== undefined) {
    container.scrollTop += anchor.getBoundingClientRect().top - container.getBoundingClientRect().top - position.anchorOffset;
  } else {
    container.scrollTop = position.top;
  }
}
