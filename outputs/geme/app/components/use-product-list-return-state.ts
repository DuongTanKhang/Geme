"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

type ProductListReturnSnapshot<T> = {
  savedAt: number;
  scrollY: number;
  state: T;
};

type Options<T> = {
  /** Stable identifier when a page contains more than one product list. */
  listId: string;
  /** The list state to restore when returning from a product detail page. */
  state: T;
  onRestore: (state: T) => void;
  /** Change when the restored list has rendered (for example, visible count/page). */
  readyKey: unknown;
};

const STORAGE_PREFIX = "geme:product-list-return:v1:";
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;

function getStorageKey(listId: string) {
  return `${STORAGE_PREFIX}${listId}:${window.location.pathname}${window.location.search}`;
}

/**
 * Saves a listing's view only when leaving for a product detail page, then
 * restores its filters/pagination and scroll position when the user returns.
 */
export function useProductListReturnState<T>({ listId, state, onRestore, readyKey }: Options<T>): MutableRefObject<boolean> {
  const stateRef = useRef(state);
  const restoreRef = useRef(onRestore);
  const pendingScrollRef = useRef<number | null>(null);
  const isRestoringRef = useRef(false);

  stateRef.current = state;
  restoreRef.current = onRestore;

  useEffect(() => {
    const storageKey = getStorageKey(listId);
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (!raw) return;

      window.sessionStorage.removeItem(storageKey);
      const snapshot = JSON.parse(raw) as ProductListReturnSnapshot<T>;
      if (!Number.isFinite(snapshot.savedAt) || Date.now() - snapshot.savedAt > SNAPSHOT_TTL_MS || !Number.isFinite(snapshot.scrollY)) return;

      isRestoringRef.current = true;
      pendingScrollRef.current = Math.max(0, snapshot.scrollY);
      restoreRef.current(snapshot.state);
    } catch {
      window.sessionStorage.removeItem(storageKey);
    }
  }, [listId]);

  useEffect(() => {
    const saveBeforeProductNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || (target.target && target.target !== "_self")) return;

      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin || !/^\/san-pham\/[^/]+\/?$/.test(destination.pathname)) return;

      const snapshot: ProductListReturnSnapshot<T> = {
        savedAt: Date.now(),
        scrollY: window.scrollY,
        state: stateRef.current,
      };
      try {
        window.sessionStorage.setItem(getStorageKey(listId), JSON.stringify(snapshot));
      } catch {
        // Scroll restoration is an enhancement; navigation must still work if
        // the browser blocks session storage.
      }
    };

    document.addEventListener("click", saveBeforeProductNavigation, true);
    return () => document.removeEventListener("click", saveBeforeProductNavigation, true);
  }, [listId]);

  useEffect(() => {
    const targetY = pendingScrollRef.current;
    if (targetY == null) return;

    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: targetY, left: 0, behavior: "instant" });
        pendingScrollRef.current = null;
        isRestoringRef.current = false;
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [readyKey]);

  return isRestoringRef;
}
