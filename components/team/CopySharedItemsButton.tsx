"use client";

import { useState } from "react";

type State = "idle" | "copying" | "done" | "error";

/**
 * Copies every collection & comparison shared with the user's team into
 * their own account (`/api/team/shared/copy-all`). Shown on the
 * team-inactive interstitial so a lapsed member can keep shared work
 * before their access ends.
 */
export default function CopySharedItemsButton({
  className,
  count
}: {
  className?: string;
  count: number;
}) {
  const [state, setState] = useState<State>("idle");

  async function handleClick() {
    if (state === "copying" || state === "done") return;
    setState("copying");
    try {
      const res = await fetch("/api/team/shared/copy-all", {
        method: "POST",
        credentials: "include"
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={state === "copying" || state === "done"}
    >
      {state === "done"
        ? "Copied to your account ✓"
        : state === "copying"
          ? "Copying…"
          : state === "error"
            ? "Retry copy"
            : `Copy ${count} shared item${count === 1 ? "" : "s"} to my account`}
    </button>
  );
}
