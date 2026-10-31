import { describe, expect, it } from "vitest";
import { TerminalModel } from "./model";
import { rowText } from "./rows";

const lines = (from: number, to: number): string => Array.from({ length: to - from + 1 }, (_, i) => `l${String(from + i)}`).join("\r\n");
const texts = (rows: readonly { runs: { text: string }[] }[]): string[] => rows.map((row) => row.runs.map((run) => run.text).join(""));

/** A 5-row, 20-column model whose snapshot's reset has already been taken. */
async function model(): Promise<{ model: TerminalModel; write: (data: string) => Promise<void> }> {
  const model = new TerminalModel();
  await model.snapshot({ cols: 20, rows: 5, restore: new Uint8Array() });
  model.frame();
  return { model, write: (data) => new Promise((done) => { model.term.write(data, done); }) };
}

describe("TerminalModel.frame", () => {
  it("reports each line that left the screen once, with a style that runs across a row boundary", async () => {
    const { model: m, write } = await model();
    await write(`\x1b[31mred one\r\nred two\x1b[0m\r\n${lines(3, 8)}`);
    const first = m.frame();
    expect(first).toMatchObject({ reset: false, gap: false });
    expect(texts(first.frozen)).toEqual(["red one", "red two", "l3"]);
    expect(first.frozen[1]?.runs[0]?.style).toEqual({ fg: 1 });
    expect(texts(first.screen)).toEqual(["l4", "l5", "l6", "l7", "l8"]);
    expect(first.cursor).toMatchObject({ row: 4, col: 2, visible: true });

    await write("\r\nl9\r\nl10\r\n");
    const next = m.frame();
    expect(texts(next.frozen)).toEqual(["l4", "l5", "l6"]);
    expect(m.frame().frozen).toEqual([]);
  });

  it("skips the lines xterm trimmed and keeps the newest two screens, with a gap", async () => {
    const { model: m, write } = await model();
    await write(`${lines(1, 6000)}\r\n`);
    const frame = m.frame();
    expect(frame.gap).toBe(true);
    expect(texts(frame.frozen)).toEqual(Array.from({ length: 10 }, (_, i) => `l${String(5987 + i)}`));
  });

  it("resets on ED3 and on a snapshot, keeping only what came after", async () => {
    const { model: m, write } = await model();
    await write(`${lines(1, 12)}\x1b[3J\r\n${lines(13, 20)}`);
    const frame = m.frame();
    expect(frame.reset).toBe(true);
    expect(texts(frame.frozen)).toEqual(["l8", "l9", "l10", "l11", "l12", "l13", "l14", "l15"]);
    await m.snapshot({ cols: 20, rows: 5, restore: new TextEncoder().encode("restored") });
    const restored = m.frame();
    expect(restored.reset).toBe(true);
    expect(restored.frozen).toEqual([]);
    expect(restored.screen.map(rowText)[0]).toBe("restored");
  });

  it.each([["Ctrl-L", "\x1b[H\x1b[2J"], ["clear under TERM=screen", "\x1b[H\x1b[J"]])("freezes the screen on %s as tmux does", async (_name, clear) => {
    const { model: m, write } = await model();
    await write(lines(1, 8));
    m.frame();
    await write(`${clear}b1\r\nb2`);
    const frame = m.frame();
    expect(frame.reset).toBe(false);
    expect(texts(frame.frozen)).toEqual(["l4", "l5", "l6", "l7", "l8"]);
    expect(texts(frame.screen).slice(0, 2)).toEqual(["b1", "b2"]);
  });

  it("freezes nothing while an application owns the alternate screen, and carries on after it", async () => {
    const { model: m, write } = await model();
    await write(lines(1, 8));
    m.frame();
    await write(`\x1b[?1049h${lines(1, 12)}`);
    const inApp = m.frame();
    expect(inApp.frozen).toEqual([]);
    expect(texts(inApp.screen)).toEqual(["l8", "l9", "l10", "l11", "l12"]);
    await write("\x1b[?1049l\r\nl9");
    expect(texts(m.frame().frozen)).toEqual(["l4"]);
  });
});
