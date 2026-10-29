import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads `load()` when the screen opens (and again with `reload`), keeping the last data while it reloads. A load
 * that finishes after the screen closed, or after a newer one started, is dropped. `everyMs`: load again on that
 * interval while `poll` is true (notes being prepared, for one).
 */
export function useLoad<T>(
  load: (() => Promise<T>) | null,
  options: { everyMs?: number; poll?: boolean } = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(load != null);
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const run = loadRef.current;
    if (!run) {
      return;
    }
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const next = await run();
      if (ticket === latest.current) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (ticket === latest.current) {
        setError(e);
      }
    } finally {
      if (ticket === latest.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    reload();
    return () => {
      latest.current += 1;
    };
  }, [reload]);

  const { everyMs, poll } = options;
  useEffect(() => {
    if (!everyMs || !poll) {
      return;
    }
    const timer = setInterval(reload, everyMs);
    return () => clearInterval(timer);
  }, [everyMs, poll, reload]);

  return { data, error, loading, reload, setData };
}
