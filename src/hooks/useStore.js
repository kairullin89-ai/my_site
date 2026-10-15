import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe } from "../lib/store.js";

export function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
