import { initializeApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  inMemoryPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
  doc,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import type { Dataset, Song } from "../shared/model.js";
const env = import.meta.env;
export const configured = Boolean(
  env.VITE_FIREBASE_API_KEY &&
  env.VITE_FIREBASE_AUTH_DOMAIN &&
  env.VITE_FIREBASE_PROJECT_ID &&
  env.VITE_FIREBASE_APP_ID,
);
const app = configured
  ? initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    })
  : null;
export const auth = app ? getAuth(app) : null;
const db = app
  ? initializeFirestore(app, { localCache: memoryLocalCache() })
  : null;
const functions = app ? getFunctions(app, "asia-northeast1") : null;
export type State = {
  control: {
    activeDatasetId: string;
    previousDatasetId: string | null;
    revision: number;
  };
  data: Dataset;
  songs: Song[];
  syncedAt: string | null;
};
export const invoke = async <T = unknown>(
  name: string,
  data: unknown = {},
): Promise<T> => {
  if (!navigator.onLine) throw new Error("インターネットに接続してください");
  if (!functions) throw new Error("Firebase設定が必要です");
  return (await httpsCallable<unknown, T>(functions, name)(data)).data;
};
export async function login() {
  if (!auth) return;
  await setPersistence(auth, inMemoryPersistence);
  await signInWithPopup(auth, new GoogleAuthProvider());
}
export const logout = async () => {
  if (auth) await signOut(auth);
};
export function watchState(
  uid: string,
  refresh: () => void,
  fail: (error: Error) => void,
) {
  if (!db) throw new Error("Firebase未設定");
  return onSnapshot(
    doc(db, "users", uid, "control", "state"),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!snapshot.metadata.fromCache) refresh();
    },
    fail,
  );
}
