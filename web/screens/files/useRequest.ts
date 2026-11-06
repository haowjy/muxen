import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../../app/context";
import { HttpRefusal } from "../../net/http";

/**
 * One request from a form or a dialog at a time. `run` answers true when the work is done and the component still
 * there; a refusal shows in `error`, or, once the component has gone, as a notice beginning `failed`. Busy stays on after
 * a success, since the component is about to close.
 */
export function useRequest(words: (refused: HttpRefusal) => string) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => () => { mounted.current = false; }, []);
  const run = async (work: () => Promise<void>, failed: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      return mounted.current;
    } catch (refused) {
      if (!(refused instanceof HttpRefusal)) throw refused;
      if (!mounted.current) {
        app.notify(`${failed}: ${words(refused)}`);
        return false;
      }
      setError(words(refused));
      setBusy(false);
      return false;
    }
  };
  return { busy, error, clear: () => { setError(null); }, run };
}
