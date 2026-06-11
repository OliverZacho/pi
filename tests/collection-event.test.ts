import { describe, expect, it } from "vitest";
import {
  isEligibleForEventDetection,
  isEventDetectionStale,
  safeParseEventDetection,
  type CollectionEventDetection
} from "@/lib/collection-event-shared";
import { buildTimelineModel } from "@/components/collections/CollectionEventInsights";
import { explicitPhaseFromSubject } from "@/lib/collection-event";
import type { ExploreEmailCard } from "@/lib/explore-db";

function card(overrides: Partial<ExploreEmailCard>): ExploreEmailCard {
  return {
    id: Math.random().toString(36).slice(2),
    subject: "Join us",
    preheader: null,
    companyId: null,
    companyName: "Brand",
    companyDomain: null,
    companyMarkets: [],
    companyLogoUrl: null,
    receivedAt: "2026-06-01T08:00:00+00:00",
    category: "event",
    hasGif: false,
    hasDarkMode: false,
    discountPercent: null,
    promoCode: null,
    ...overrides
  };
}

function manyCards(
  count: number,
  build: (index: number) => Partial<ExploreEmailCard>
): ExploreEmailCard[] {
  return Array.from({ length: count }, (_, index) => card(build(index)));
}

describe("isEligibleForEventDetection", () => {
  it("rejects collections with too few emails", () => {
    const emails = manyCards(7, (i) => ({ companyName: `Brand ${i}` }));
    expect(isEligibleForEventDetection(emails)).toBe(false);
  });

  it("rejects collections dominated by a single brand pair", () => {
    const emails = manyCards(10, (i) => ({
      companyName: i % 2 === 0 ? "A" : "B"
    }));
    expect(isEligibleForEventDetection(emails)).toBe(false);
  });

  it("rejects collections without enough event-ish categories", () => {
    const emails = manyCards(10, (i) => ({
      companyName: `Brand ${i % 4}`,
      category: i < 3 ? "event" : "sale"
    }));
    expect(isEligibleForEventDetection(emails)).toBe(false);
  });

  it("accepts an event-shaped collection (seasonal counts too)", () => {
    const emails = manyCards(10, (i) => ({
      companyName: `Brand ${i % 4}`,
      category: i % 2 === 0 ? "event" : i % 3 === 0 ? "seasonal" : "sale"
    }));
    expect(isEligibleForEventDetection(emails)).toBe(true);
  });
});

function detection(
  overrides: Partial<CollectionEventDetection> = {}
): CollectionEventDetection {
  return {
    version: 1,
    status: "detected",
    detectedAt: "2026-06-11T09:00:00.000Z",
    emailCountAtDetection: 45,
    model: "claude-haiku-4-5",
    confirmed: null,
    event: {
      name: "3daysofdesign",
      startDate: "2026-06-10",
      endDate: "2026-06-12",
      location: "Copenhagen",
      kind: "festival",
      confidence: 0.99,
      userMessage: "It looks like you're collecting emails about 3daysofdesign."
    },
    phases: {},
    ...overrides
  };
}

describe("explicitPhaseFromSubject", () => {
  it("pins literal save-the-date subjects regardless of casing", () => {
    expect(explicitPhaseFromSubject("SAVE THE DATES")).toBe("save_the_date");
    expect(explicitPhaseFromSubject("Save the date for our show")).toBe(
      "save_the_date"
    );
  });

  it("pins doors-open subjects", () => {
    expect(explicitPhaseFromSubject("Now Open | 3daysofdesign")).toBe("day_of");
    expect(explicitPhaseFromSubject("We're open!")).toBe("day_of");
    expect(explicitPhaseFromSubject("The doors are open")).toBe("day_of");
  });

  it("leaves interpretive subjects to the model", () => {
    expect(explicitPhaseFromSubject("Join us at 3daysofdesign")).toBeNull();
    expect(explicitPhaseFromSubject("Programme for 3daysofdesign")).toBeNull();
    expect(explicitPhaseFromSubject("The exhibition is open")).toBeNull();
  });
});

describe("isEventDetectionStale", () => {
  it("stays fresh until the collection grows by the threshold", () => {
    expect(isEventDetectionStale(detection(), 45)).toBe(false);
    expect(isEventDetectionStale(detection(), 54)).toBe(false);
    expect(isEventDetectionStale(detection(), 55)).toBe(true);
  });
});

describe("safeParseEventDetection", () => {
  it("round-trips a valid payload", () => {
    const parsed = safeParseEventDetection(
      JSON.parse(JSON.stringify(detection({ phases: { abc: "reminder" } })))
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.event?.name).toBe("3daysofdesign");
    expect(parsed?.event?.startDate).toBe("2026-06-10");
    expect(parsed?.phases).toEqual({ abc: "reminder" });
  });

  it("rejects garbage and wrong versions", () => {
    expect(safeParseEventDetection(null)).toBeNull();
    expect(safeParseEventDetection("nope")).toBeNull();
    expect(safeParseEventDetection({ version: 2 })).toBeNull();
    expect(safeParseEventDetection({ version: 1, status: "weird" })).toBeNull();
  });

  it("drops unknown phases and malformed dates instead of failing", () => {
    const raw = JSON.parse(
      JSON.stringify(detection({ phases: { a: "reminder", b: "bogus" } }))
    );
    raw.event.startDate = "June 10";
    const parsed = safeParseEventDetection(raw);
    expect(parsed?.phases).toEqual({ a: "reminder" });
    expect(parsed?.event?.startDate).toBeNull();
  });

  it("requires an event payload when status is detected", () => {
    const raw = JSON.parse(JSON.stringify(detection()));
    raw.event = null;
    expect(safeParseEventDetection(raw)).toBeNull();
  });
});

describe("buildTimelineModel", () => {
  const emails = [
    card({
      id: "e1",
      companyName: "Early Bird",
      receivedAt: "2026-05-13T08:00:00+00:00"
    }),
    card({
      id: "e2",
      companyName: "Early Bird",
      receivedAt: "2026-06-09T08:00:00+00:00"
    }),
    card({
      id: "e3",
      companyName: "Mid Mover",
      receivedAt: "2026-05-27T10:00:00+00:00",
      category: "product_launch"
    }),
    card({
      id: "e4",
      companyName: "Door Opener",
      receivedAt: "2026-06-10T07:00:00+00:00"
    }),
    card({
      id: "e5",
      companyName: "Door Opener",
      receivedAt: "2026-06-10T12:00:00+00:00"
    })
  ];

  const det = detection({
    phases: {
      e1: "save_the_date",
      e2: "reminder",
      e3: "programme",
      e4: "day_of",
      e5: "day_of"
    }
  });

  it("computes the window from first email to event end", () => {
    const model = buildTimelineModel(det, emails);
    expect(model).not.toBeNull();
    // May 13 → June 12 inclusive = 31 days.
    expect(model!.totalDays).toBe(31);
    expect(model!.eventStartIdx).toBe(28);
    expect(model!.eventEndIdx).toBe(30);
  });

  it("orders brands by earliest send and counts stats", () => {
    const model = buildTimelineModel(det, emails)!;
    expect(model.brands.map((b) => b.name)).toEqual([
      "Early Bird",
      "Mid Mover",
      "Door Opener"
    ]);
    expect(model.stats.brandCount).toBe(3);
    expect(model.stats.emailCount).toBe(5);
    // First email May 13, event starts June 10 → 28 days head start.
    expect(model.stats.headStartDays).toBe(28);
    expect(model.stats.busiestCount).toBe(2);
  });

  it("buckets daily counts and phase lanes in campaign order", () => {
    const model = buildTimelineModel(det, emails)!;
    expect(model.dailyCounts[0]).toBe(1);
    expect(model.dailyCounts[28]).toBe(2);
    expect(model.maxDaily).toBe(2);
    expect(model.phaseLanes.map((lane) => lane.phase)).toEqual([
      "save_the_date",
      "programme",
      "reminder",
      "day_of"
    ]);
    expect(
      model.phaseLanes.find((lane) => lane.phase === "day_of")?.items
    ).toHaveLength(2);
  });

  it("buckets weekly category mix with top categories", () => {
    const model = buildTimelineModel(det, emails)!;
    expect(model.weeks).toHaveLength(5);
    expect(model.weeks[0].total).toBe(1);
    expect(model.topCategories[0]).toBe("event");
    expect(model.topCategories).toContain("product_launch");
  });

  it("survives a missing event date by using the email span", () => {
    const noDates = detection({
      event: { ...det.event!, startDate: null, endDate: null },
      phases: det.phases
    });
    const model = buildTimelineModel(noDates, emails)!;
    expect(model.eventStartIdx).toBeNull();
    // May 13 → June 10 inclusive = 29 days.
    expect(model.totalDays).toBe(29);
  });

  it("returns null without emails or event payload", () => {
    expect(buildTimelineModel(det, [])).toBeNull();
    expect(
      buildTimelineModel(detection({ status: "no_event", event: null }), emails)
    ).toBeNull();
  });
});
