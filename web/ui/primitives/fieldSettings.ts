/** The keyboard settings every text box uses: a field here holds a command, a path, a name or a code, never prose. */
export const FIELD_SETTINGS = {
  autocapitalize: "off",
  autocorrect: "off",
  autocomplete: "off",
  spellcheck: "false",
  writingsuggestions: "false",
  inputmode: "text",
} as const;

/**
 * Applies `FIELD_SETTINGS`, with per-field overrides, to a text box. It sets attributes and never JSX
 * props: Preact assigns a prop to the element's property when one exists, and WebKit's `autocorrect`
 * property is a boolean, so `autocorrect="off"` became true and iOS showed autocorrect and its
 * prediction row.
 */
export function applyFieldSettings(el: HTMLElement | null, overrides: Partial<Record<keyof typeof FIELD_SETTINGS, string>> = {}): void {
  if (!el) return;
  for (const [name, value] of Object.entries({ ...FIELD_SETTINGS, ...overrides })) el.setAttribute(name, value);
}
