const transformationParameters = [
  "width",
  "height",
  "gravity",
  "quality",
  "borderWidth",
  "borderColor",
  "borderRadius",
  "opacity",
  "rotation",
  "background",
  "output",
];

// Legacy records contain preview URLs, which require paid image transformations.
// Serve their original files while preserving project and access parameters.
export function getFileViewUrl(imageUrl: string, endpoint: string): string {
  try {
    const url = new URL(imageUrl);
    const base = new URL(endpoint);
    const basePath = base.pathname.replace(/\/+$/, "");

    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(`${basePath}/`) ||
      !/^\/storage\/buckets\/[^/]+\/files\/[^/]+\/preview$/.test(
        url.pathname.slice(basePath.length)
      )
    ) {
      return imageUrl;
    }

    url.pathname = url.pathname.replace(/\/preview$/, "/view");
    transformationParameters.forEach((parameter) => {
      url.searchParams.delete(parameter);
    });

    return url.toString();
  } catch {
    return imageUrl;
  }
}

// Appwrite relationships nest images in creators, posts, likes, and saved posts.
// Normalize copies before they reach the UI, without migrating stored records.
export function normalizeImageUrls<T>(value: T, endpoint: string): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeImageUrls(item, endpoint)) as T;
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "imageUrl" && typeof item === "string"
          ? getFileViewUrl(item, endpoint)
          : normalizeImageUrls(item, endpoint),
      ])
    ) as T;
  }

  return value;
}
