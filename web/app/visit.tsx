"use client";

import { useEffect } from "react";

/**
 * Stamps "you were here" after the page has rendered, so the count the page
 * just showed was measured against the *previous* visit rather than this one.
 *
 * A Server Component cannot set a cookie — only an action or a route handler
 * can — and this needs no round trip, so it is written from the browser.
 */
export function StampVisit() {
  useEffect(() => {
    const year = 365 * 24 * 60 * 60;
    document.cookie = `jobscout_seen=${Date.now()}; path=/; max-age=${year}; samesite=lax`;
  }, []);
  return null;
}
