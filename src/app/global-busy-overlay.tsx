"use client";

import { useEffect, useState } from "react";

type BusyState = {
  count: number;
  listeners: Set<(active: boolean) => void>;
  originalFetch?: typeof fetch;
  patched: boolean;
};

type FnosRequestInit = RequestInit & {
  fnosSkipBusyOverlay?: boolean;
};

declare global {
  interface Window {
    __fnosBusyState?: BusyState;
  }
}

function getBusyState() {
  if (!window.__fnosBusyState) {
    window.__fnosBusyState = {
      count: 0,
      listeners: new Set(),
      patched: false,
    };
  }
  return window.__fnosBusyState;
}

function notifyBusy(state: BusyState) {
  const active = state.count > 0;
  state.listeners.forEach((listener) => listener(active));
}

function setBusyDelta(delta: number) {
  const state = getBusyState();
  state.count = Math.max(0, state.count + delta);
  notifyBusy(state);
}

function installFetchBusyTracker() {
  const state = getBusyState();
  if (state.patched || typeof window.fetch !== "function") return;
  state.originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const init = args[1] as FnosRequestInit | undefined;
    const skipBusyOverlay = Boolean(init?.fnosSkipBusyOverlay);
    if (!skipBusyOverlay) setBusyDelta(1);
    try {
      return await state.originalFetch!(...args);
    } finally {
      if (!skipBusyOverlay) setBusyDelta(-1);
    }
  };
  state.patched = true;
}

export default function GlobalBusyOverlay() {
  const [active, setActive] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    installFetchBusyTracker();
    const state = getBusyState();
    const listener = (nextActive: boolean) => setActive(nextActive);
    state.listeners.add(listener);
    listener(state.count > 0);

    const start = () => setBusyDelta(1);
    const end = () => setBusyDelta(-1);
    window.addEventListener("fnos:busy-start", start);
    window.addEventListener("fnos:busy-end", end);
    return () => {
      state.listeners.delete(listener);
      window.removeEventListener("fnos:busy-start", start);
      window.removeEventListener("fnos:busy-end", end);
    };
  }, []);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!visible) return null;

  return (
    <div className="fn-global-busy-overlay" aria-live="polite" aria-label="작업 중">
      <div className="fn-global-busy-logo" aria-hidden="true">F&amp;</div>
    </div>
  );
}
