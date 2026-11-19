export function postSaveErrorMessage(error: unknown, action: "Create" | "Update") {
  if (error && typeof error === "object" && "type" in error &&
    error.type === "storage_invalid_file_size") {
    return "This photo exceeds the upload size limit. Choose a smaller image and try again. Your draft is still here.";
  }
  return action === "Create"
    ? "Couldn’t publish your post. Your changes are still here. Try again."
    : "Couldn’t save your changes. Your changes are still here. Try again.";
}
