/** http(s) opens a page that gets no reference back to this one; mailto: hands the address to the mail app and leaves this page in place. */
export function openURL(url: string): void {
  if (/^mailto:/i.test(url)) location.assign(url);
  else if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener");
}

/**
 * The muxen app runs only on iPhone and iPad. iPadOS 13+ reports a Macintosh user agent, told
 * apart from a Mac by its touch points. A UA can be spoofed and the page cannot see whether the
 * app is installed, so on iOS the offer may still find nothing to open.
 */
export function canOpenApp(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** A Mac, iPad or iPhone, whose keyboards say ⌘ where others say Ctrl. */
export function appleKeyboard(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

/** The one place that knows the app's scheme: `muxen://add?host=<origin>[&code=<code>]`. With a code the app enrols itself; without one it mints from this device's node enrolment. */
export function openInApp(origin: string, code: string | null): void {
  location.assign(`muxen://add?host=${encodeURIComponent(origin)}${code === null ? "" : `&code=${encodeURIComponent(code)}`}`);
}

/** The browser's own download: a same-origin `<a download>` on `/fs/raw`, which its CSP `sandbox` header doesn't stop in Chromium (Safari unchecked). */
export function download(url: string, name: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
}
