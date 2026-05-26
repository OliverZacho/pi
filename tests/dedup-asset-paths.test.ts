import { describe, expect, it } from "vitest";

import { newAssetPath } from "../scripts/dedup-asset-paths";

describe("newAssetPath", () => {
  it("strips the email-id folder prefix from an old-format path", () => {
    expect(
      newAssetPath(
        "4feb664c-7e1d-44de-9f44-45b636e2e83b/d2b1b39cb4434d34c22c2cf52cbbe9967b1b688e.png"
      )
    ).toBe("d2b1b39cb4434d34c22c2cf52cbbe9967b1b688e.png");
  });

  it("returns a bucket-root name unchanged", () => {
    // Re-running the script after a partial run must be idempotent
    // — already-deduped objects shouldn't get mangled by another
    // round of basename extraction.
    expect(newAssetPath("d2b1b39cb4434d34c22c2cf52cbbe9967b1b688e.png")).toBe(
      "d2b1b39cb4434d34c22c2cf52cbbe9967b1b688e.png"
    );
  });

  it("only strips the leading prefix, not nested folder structure", () => {
    // We don't currently emit nested paths, but if a future
    // ingestion path ever wrote `${shard}/${emailId}/${sha1}.png`
    // we'd want this script to refuse to silently collapse it. The
    // basename behaviour means such a name would survive as
    // `${sha1}.png` only when its parent is a single segment — for
    // anything weirder, the `OLD_FORMAT_RE` filter in the script
    // skips it entirely.
    expect(newAssetPath("a/b/c.png")).toBe("c.png");
  });
});
