// The words for a daemon upload refusal (fs.md "Errors"), shared by every platform: the browser
// reads the code from the response body, native passes the code it read in its `upload` event.

const REFUSALS: Record<string, string> = {
  too_large: "That file is over the 128 MiB limit",
  busy: "The server is busy. Try again in a moment",
  no_space: "The server is out of disk space",
  not_a_directory: "That isn't a usable folder. For the uploads folder, check uploads_dir in config.toml",
  denied: "That folder isn't writable",
  not_found: "That folder no longer exists",
  memory_backed: "The uploads folder is on memory-backed storage",
};

/** What to tell the user about the daemon's refusal `code`. */
export function uploadFailure(code: string): string {
  return REFUSALS[code] ?? `Upload failed (${code})`;
}
