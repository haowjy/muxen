import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { HttpRefusal } from "../net/http";
import { refusalWords } from "../net/refusalWords";
import { useApp } from "./context";

/**
 * One request from a form or a dialog at a time. `run` answers true when the work is done and the component still there.
 * The work fails by throwing a refusal, worded by `words`, or by answering the words as a string. A failure shows in `error`,
 * or, once the component has gone, as a notice beginning `failed`.
 */
export function useRequest(words: (refused: HttpRefusal) => string = (refused) => refusalWords(refused.code)) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => () => { mounted.current = false; }, []);
  const run = async (work: () => Promise<unknown>, failed: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    let said: string | null;
    try {
      const answer = await work();
      said = typeof answer === "string" ? answer : null;
    } catch (refused) {
      if (!(refused instanceof HttpRefusal)) throw refused;
      said = words(refused);
    } finally {
      setBusy(false);
    }
    if (said === null) return mounted.current;
    if (mounted.current) setError(said);
    else app.notify(`${failed}: ${said}`);
    return false;
  };
  return { busy, error, clear: () => { setError(null); }, run };
}
