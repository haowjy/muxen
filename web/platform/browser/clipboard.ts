import type { Clipboard } from "../types";

/** Both calls run inside the user's gesture: Safari shows its own Paste confirmation for `read`. */
export async function readClipboard(): ReturnType<Clipboard["read"]> {
  try {
    for (const item of await navigator.clipboard.read()) {
      const image = item.types.find((type) => type.startsWith("image/"));
      if (image) return { image: new File([await item.getType(image)], `pasted-image.${image.slice("image/".length).split("+")[0] ?? ""}`, { type: image }) };
      if (item.types.includes("text/plain")) {
        const text = await (await item.getType("text/plain")).text();
        if (text) return { text };
      }
    }
    return "empty";
  } catch {
    return "denied";
  }
}

export const clipboard: Clipboard = {
  async writeText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return "ok";
    } catch {
      return "denied";
    }
  },
  read: readClipboard,
};
