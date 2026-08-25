/**
 * Hand the user a file without a network round-trip.
 * Revoking on the next tick keeps Safari from cancelling the download.
 */
const downloadText = (filename: string, contents: string): void => {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** "production-1 key" -> "production-1-key" so it is safe as a filename. */
const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "ssh-key";

export { downloadText, slugify };
