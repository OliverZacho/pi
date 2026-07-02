import { describe, expect, it } from "vitest";
import {
  buildSmartCollectionModel,
  type CollectionMatch
} from "@/lib/notifications/smart-collection-build";
import { renderSmartCollectionEmail } from "@/lib/notifications/smart-collection-render";

function match(
  name: string,
  newCount: number,
  samples: { subject: string; brandName: string | null }[] = []
): CollectionMatch {
  return { collectionId: `id-${name}`, collectionName: name, newCount, samples };
}

describe("buildSmartCollectionModel", () => {
  it("drops empty collections and sorts busiest first", () => {
    const model = buildSmartCollectionModel("daily", [
      match("Small", 1),
      match("Empty", 0),
      match("Big", 5)
    ]);
    expect(model.collections.map((c) => c.collectionName)).toEqual([
      "Big",
      "Small"
    ]);
    expect(model.totalNew).toBe(6);
  });
});

describe("renderSmartCollectionEmail", () => {
  it("names the single collection in the subject", () => {
    const model = buildSmartCollectionModel("weekly", [
      match("Black Friday watch", 3, [
        { subject: "Up to 50% off", brandName: "ARKET" }
      ])
    ]);
    const { subject, html } = renderSmartCollectionEmail(model);
    expect(subject).toBe('3 new emails in "Black Friday watch"');
    expect(html).toContain("ARKET");
    // The collection header deep-links to the collection page.
    expect(html).toContain(
      `/collections/${encodeURIComponent("id-Black Friday watch")}`
    );
    expect(html).not.toContain("—");
  });

  it("summarizes across several collections", () => {
    const model = buildSmartCollectionModel("weekly", [
      match("A", 2),
      match("B", 1)
    ]);
    expect(renderSmartCollectionEmail(model).subject).toBe(
      "New matches in 2 collections"
    );
  });
});
