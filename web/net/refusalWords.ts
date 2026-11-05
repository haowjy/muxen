import type { HttpError } from "../proto/generated/messages";

// The words for every code a daemon route answers with (fs.md "Errors"), the one source for the
// file manager (`describeError`) and for uploads. Keyed by the generated
// `HttpError`, so a new daemon code fails tsc until it has words.
const WORDS: Record<HttpError, string> = {
  bad_request: "The server refused that request.",
  auth_required: "This device isn't signed in to that server.",
  forbidden: "This device isn't allowed on that server.",
  bad_origin: "The server refused this page.",
  node_refused: "That server refused the request.",
  not_enrolled: "This device isn't enrolled on that server.",
  bad_code: "That enrolment code didn't work.",
  denied: "Permission denied.",
  not_found: "It isn't there any more.",
  not_a_directory: "That isn't a folder.",
  not_a_file: "That isn't a regular file.",
  memory_backed: "That folder is on memory-backed storage.",
  config_read_only: "config.toml can't be written on the server: a broken link or a read-only file.",
  too_large: "That file is over the 128 MiB limit.",
  bad_range: "The server couldn't read that part of the file.",
  busy: "The server is busy. Try again in a moment.",
  auth_unavailable: "The server can't check devices right now.",
  identity_unavailable: "The server can't tell who you are right now.",
  config_unavailable: "config.toml on the server can't be read or doesn't parse. Fix it there.",
  no_space: "The server is out of disk space.",
  internal: "Something went wrong on the server.",
};

/** What to tell the user about a refusal `code`: a daemon code has its words, any other (the client's `http_<status>`) is named. */
export function refusalWords(code: string): string {
  return Object.hasOwn(WORDS, code) ? WORDS[code as HttpError] : `Something went wrong (${code}).`;
}
