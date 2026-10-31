import { describe, expect, it } from "vitest";
import { BUDGETS, budgetBreaches, findColourLiterals, findColourPrimitiveUses, findCopyViolations, initialSizes } from "./checks.mjs";

describe("copy rule", () => {
  it("fails on a middle dot, a bullet and a dot marker, and passes plain copy", () => {
    expect(findCopyViolations("a · b")).toHaveLength(1);
    expect(findCopyViolations("ok\n• item")).toHaveLength(1);
    expect(findCopyViolations("status ● live")).toHaveLength(1);
    expect(findCopyViolations("muxen / agent, 2 windows. Checking access…")).toEqual([]);
  });
});

describe("colour tokens", () => {
  it("fails on a colour scale read outside semantic.css, and passes semantic.css and scales that aren't colour", () => {
    expect(findColourPrimitiveUses("ui/primitives/Button.module.css", "color: var(--gray-5);")).toHaveLength(1);
    expect(findColourPrimitiveUses("screens/home/Home.module.css", "background: var( --blue-9 );")).toHaveLength(1);
    expect(findColourPrimitiveUses("ui/tokens/semantic.css", "--color-bg: var(--gray-12);")).toEqual([]);
    expect(findColourPrimitiveUses("screens/home/Home.module.css", "gap: var(--space-3); color: var(--color-text);")).toEqual([]);
  });
});

describe("colour literals", () => {
  it("fails on a raw colour in component CSS, and passes tokens, the token files and non-colour hashes", () => {
    for (const css of ["color: oklch(0 0 0 / 0.3);", "color: #fff;", "background: rgb(0 0 0);", "color: hsl(0 0% 0%);"]) {
      expect(findColourLiterals("ui/primitives/Toast.module.css", css)).toHaveLength(1);
    }
    expect(findColourLiterals("ui/primitives/Toast.module.css", "box-shadow: 0 8px 24px var(--color-shadow);")).toEqual([]);
    expect(findColourLiterals("ui/tokens/semantic.css", "--color-shadow: oklch(0 0 0 / 0.3);")).toEqual([]);
    expect(findColourLiterals("screens/home/Home.module.css", "grid-area: x; .a#b { color: var(--color-text); }")).toEqual([]);
  });
});

describe("budgets", () => {
  const entry = { file: "assets/index.js", isEntry: true, imports: ["_vendor"], css: ["assets/index.css"] };
  const manifest = { "index.html": entry, _vendor: { file: "assets/vendor.js" } };
  const file = (path: string, gz: number) => ({ path, bytes: gz, gz });
  const ok = [file("assets/index.js", 50_000), file("assets/vendor.js", 100_000), file("assets/index.css", 6_000)];

  it("passes a build within budget, and records the startup bundle without failing on its size", () => {
    expect(budgetBreaches(ok, manifest)).toEqual([]);
    const huge = [file("assets/index.js", 900_000), file("assets/vendor.js", 400_000), file("assets/index.css", 90_000)];
    expect(budgetBreaches(huge, manifest)).toEqual([]);
    // The entry plus its static import, and the CSS those carry.
    expect(initialSizes(huge, manifest)).toEqual({ js: 1_300_000, css: 90_000 });
  });
  it("fails a terminal font over 120 KB, the symbols over 150 KB, too many files (stubs included) and a shell over 1.5 MiB", () => {
    expect(budgetBreaches([...ok, file("assets/muxen-mono-bold-x.woff2", BUDGETS.terminalFont + 1)], manifest).join()).toContain("muxen-mono-bold");
    expect(budgetBreaches([...ok, file("assets/muxen-symbols-x.woff2", BUDGETS.symbolsFont + 1)], manifest).join()).toContain("muxen-symbols");
    const many = [...ok, ...Array.from({ length: BUDGETS.shellFiles }, (_, i) => file(`assets/stub-${String(i)}.js`, 44))];
    expect(budgetBreaches(many, manifest).join()).toContain("files");
    expect(budgetBreaches([...ok, file("assets/big.js", BUDGETS.shell)], manifest).join()).toContain("the shell is");
  });
});
