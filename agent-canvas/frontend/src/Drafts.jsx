import { createContext, useContext, useRef, useState } from 'react';

// Transient form drafts only: owned by the mounted workspace, never written
// to storage or sent to memory. Keys include the originating space and record.
export const DraftsContext = createContext(null);
export function useDraft(key, initial) {
  const store = useContext(DraftsContext);
  const initialValue = () => store?.current.has(key) ? store.current.get(key) : typeof initial === 'function' ? initial() : initial;
  const [local, setLocal] = useState(() => ({ key, value: initialValue() }));
  const latestLocal = useRef(local);
  latestLocal.current = local;
  const value = store?.current.has(key) ? store.current.get(key)
    : local.key === key ? local.value : initialValue();
  const setValue = (next) => {
    // Async completions keep an older setter. Functional updates must still
    // compare against the latest draft, including without a workspace store.
    const previous = store?.current.has(key) ? store.current.get(key)
      : latestLocal.current.key === key ? latestLocal.current.value : initialValue();
    const updated = typeof next === 'function' ? next(previous) : next;
    store?.current.set(key, updated);
    latestLocal.current = { key, value: updated };
    setLocal(latestLocal.current);
  };
  return [value, setValue];
}
