import { useEffect, useState } from "preact/hooks";

/** The clock for countdowns and "Connecting…" while the tab on screen is not live. */
export function useNow(running: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => { setNow(Date.now()); }, everyMs);
    return () => { clearInterval(timer); };
  }, [running, everyMs]);
  return running ? now : Date.now();
}
