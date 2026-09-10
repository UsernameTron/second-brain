import { createContext, useContext, useState } from 'react';

// Transient form drafts only: owned by the mounted workspace, never written
// to storage or sent to memory. Keys include the originating space and record.
export const DraftsContext = createContext(null);
export function useDraft(key, initial) {
  const store = useContext(DraftsContext);
  const initialValue = () => store?.current.has(key) ? store.current.get(key) : typeof initial === 'function' ? initial() : initial;
  const [local, setLocal] = useState(() => ({ key, value: initialValue() }));
  const value = local.key === key ? local.value : initialValue();
  const setValue = (next) => {
    const previous = store?.current.has(key) ? store.current.get(key) : value;
    const updated = typeof next === 'function' ? next(previous) : next;
    store?.current.set(key, updated);
    setLocal({ key, value: updated });
  };
  return [value, setValue];
}
