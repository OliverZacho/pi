import { describe, expect, it } from "vitest";
import {
  buildSmartCollectionModel,
  type CollectionMatch,
  type CollectionSample
} from "@/lib/notifications/smart-collection-build";
import { renderSmartCollectionEmail } from "@/lib/notifications/smart-collection-render";

function sample(
  subject: string,
  brandName: string | null,
  thumbnailUrl: string | null = null
): CollectionSample {
  return { emailId: `email-${subject}`, subject, brandName, thumbnailUrl };
}

function match(
  name: string,
  newCount: number,
  samples: CollectionSample[] = []
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
      match("Black Friday watch", 3, [sample("Up to 50% off", "ARKET")])
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

  it("deep-links each sample and renders its preview thumbnail", () => {
    const model = buildSmartCollectionModel("daily", [
      match("Launches", 2, [
        sample("New drop", "ARKET", "https://cdn.example/thumb.avif"),
        sample("Plain text update", "COS")
      ])
    ]);
    const { html } = renderSmartCollectionEmail(model);
    expect(html).toContain(
      `/explore?email=${encodeURIComponent("email-New drop")}`
    );
    expect(html).toContain('src="https://cdn.example/thumb.avif"');
    // The sample without a hero image renders text-only: exactly one <img>.
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain(
      `/explore?email=${encodeURIComponent("email-Plain text update")}`
    );
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
