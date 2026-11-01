"use client";

import { useSyncExternalStore } from "react";
import { hasSessionCookie } from "./session-hint";

const noopSubscribe = () => () => {};

/**
 * Whether a session cookie exists. False during hydration (matching static
 * HTML), the real answer straight after. Kept apart from session-hint.ts,
 * which the root layout (a server component) imports.
 */
export function useHasSessionCookie(): boolean {
  return useSyncExternalStore(noopSubscribe, hasSessionCookie, () => false);
}
