import { useEffect, useState } from 'preact/hooks';
import { msUntilNextDaily } from '../game/dates';

/** Milliseconds until the next daily round, updated every second. */
export function useCountdown() {
  const [ms, setMs] = useState(msUntilNextDaily());
  useEffect(() => {
    const t = setInterval(() => setMs(msUntilNextDaily()), 1000);
    return () => clearInterval(t);
  }, []);
  return ms;
}
