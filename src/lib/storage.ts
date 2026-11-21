import { Storage } from 'expo-sqlite/kv-store';
import type { StateStorage } from 'zustand/middleware';

// Synchronous on-device storage, so the ring screen has its data the moment it opens.
export const appStorage: StateStorage = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => {
    Storage.removeItemSync(key);
  },
};
