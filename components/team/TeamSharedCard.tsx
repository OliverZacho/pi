"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./team-shared.module.css";

type CopyState = "idle" | "copying" | "done" | "error";

/**
 * A card in the "Shared with your team" section: links into the shared
 * item (read-only) and offers a "Make a copy" action that clones it into
 * the viewer's own account via `/api/team/shared/[type]/[id]/copy`.
 */
export default function TeamSharedCard({
  type,
  id,
  href,
  name,
  meta,
  icon
}: {
  type: "collection" | "comparison";
  id: string;
  href: string;
  name: string;
  meta: string;
  icon?: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<CopyState>("idle");

  async function handleCopy() {
    if (state === "copying" || state === "done") return;
    setState("copying");
    try {
      const res = await fetch(`/api/team/shared/${type}/${id}/copy`, {
        method: "POST",
        credentials: "include"
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setState("done");
      // Surface the new copy in the owned grid above.
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <div className={styles.card}>
      <Link href={href} className={styles.cardLink}>
        <span className={styles.cardName}>
          {icon ? <span aria-hidden="true">{icon}</span> : null}
          {name}
        </span>
        <span className={styles.cardMeta}>{meta}</span>
      </Link>
      <button
        type="button"
        className={styles.copyBtn}
        onClick={handleCopy}
        disabled={state === "copying" || state === "done"}
      >
        {state === "done"
          ? "Copied ✓"
          : state === "copying"
            ? "Copying…"
            : state === "error"
              ? "Retry copy"
              : "Make a copy"}
      </button>
    </div>
  );
}
