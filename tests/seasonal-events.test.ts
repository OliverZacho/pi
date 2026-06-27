import { describe, expect, it } from "vitest";
import {
  analyzeSeasonalRunup,
  buildEventMatcher,
  countEventMentions,
  findSeasonalEvent,
  SEASONAL_EVENTS,
  upcomingOccurrence,
  type SeasonalEmailInput
} from "@/lib/seasonal-events";

function event(id: string) {
  const found = findSeasonalEvent(id);
  if (!found) throw new Error(`missing event ${id}`);
  return found;
}

describe("event date rules", () => {
  it("computes each event's primary (Danish/default) date for known years", () => {
    // The primary variant is the first entry from datesForYear.
    // Father's Day is June 5 in Denmark.
    expect(event("fathers-day").datesForYear(2025)[0]).toEqual({ month: 6, day: 5 });
    // Mother's Day: 2nd Sunday of May 2025 = May 11.
    expect(event("mothers-day").datesForYear(2025)[0]).toEqual({ month: 5, day: 11 });
    // Black Friday: 4th Friday of November 2025 = Nov 28.
    expect(event("black-friday").datesForYear(2025)[0]).toEqual({ month: 11, day: 28 });
    // Easter Sunday 2025 = April 20.
    expect(event("easter").datesForYear(2025)[0]).toEqual({ month: 4, day: 20 });
    // Easter Sunday 2024 = March 31.
    expect(event("easter").datesForYear(2024)[0]).toEqual({ month: 3, day: 31 });
  });

  it("exposes the regional variants for events that vary by country", () => {
    // Father's Day 2025: DK June 5, US/UK 3rd Sun June (15), Nordic 2nd Sun
    // Nov (9), Catholic March 19.
    expect(event("fathers-day").datesForYear(2025)).toEqual([
      { month: 6, day: 5 },
      { month: 6, day: 15 },
      { month: 11, day: 9 },
      { month: 3, day: 19 }
    ]);
    // Mother's Day 2025: 2nd Sun May (11) + UK Mothering Sunday = Easter
    // (Apr 20) minus 21 days = March 30.
    expect(event("mothers-day").datesForYear(2025)).toEqual([
      { month: 5, day: 11 },
      { month: 3, day: 30 }
    ]);
  });
});

describe("keyword matching", () => {
  it("matches on word boundaries across languages", () => {
    const matches = buildEventMatcher(event("christmas").keywords);
    expect(matches("Glædelig jul! 🎄")).toBe(true);
    expect(matches("Our Christmas gift guide")).toBe(true);
    // "jul" must not fire on the English month "July".
    expect(matches("July restock is here")).toBe(false);
    expect(matches("Just landed: new arrivals")).toBe(false);
  });

  it("handles diacritics and curly apostrophes", () => {
    expect(buildEventMatcher(event("easter").keywords)("Store påsketilbud")).toBe(true);
    expect(buildEventMatcher(event("fathers-day").keywords)("Father’s Day picks")).toBe(
      true
    );
    expect(buildEventMatcher(event("fathers-day").keywords)("Fars dag-gaver")).toBe(true);
  });
});

describe("analyzeSeasonalRunup", () => {
  const fathers = event("fathers-day");
  const now = new Date("2026-03-01T00:00:00Z");

  function email(receivedAt: string, subject: string): SeasonalEmailInput {
    return { receivedAt, subject, preheader: null };
  }

  it("returns an empty shape when nothing matches", () => {
    const result = analyzeSeasonalRunup(
      [email("2025-05-20T09:00:00Z", "Weekly new arrivals")],
      fathers,
      { now }
    );
    expect(result.matchedCount).toBe(0);
    expect(result.typicalLeadDays).toBeNull();
    expect(result.peakWeeksBefore).toBeNull();
    expect(result.weekly).toHaveLength(4);
  });

  it("measures lead time and counts across one occurrence", () => {
    // Father's Day 2025 = June 5. Mentions at 21, 7 and 0 days before.
    const result = analyzeSeasonalRunup(
      [
        email("2025-05-15T09:00:00Z", "Father's Day is coming"),
        email("2025-05-29T09:00:00Z", "Last week for Father's Day"),
        email("2025-06-05T09:00:00Z", "Happy Father's Day"),
        email("2025-06-20T09:00:00Z", "Summer drop") // no match
      ],
      fathers,
      { now }
    );
    expect(result.matchedCount).toBe(3);
    expect(result.occurrences).toBe(1);
    expect(result.earliestLeadDays).toBe(21);
    expect(result.typicalLeadDays).toBe(21);
    expect(result.perOccurrence[0]).toMatchObject({ year: 2025, count: 3, leadDays: 21 });
    // 21 days before -> week bucket 3; 7 -> 1; 0 -> 0.
    expect(result.weekly[3]).toBe(1);
    expect(result.weekly[1]).toBe(1);
    expect(result.weekly[0]).toBe(1);
  });

  it("takes the median first-mention across multiple occurrences", () => {
    const result = analyzeSeasonalRunup(
      [
        email("2024-05-22T09:00:00Z", "Father's Day gifts"), // 14 days before (2024-06-05)
        email("2025-05-15T09:00:00Z", "Father's Day gifts"), // 21 days before (2025-06-05)
        email("2023-05-26T09:00:00Z", "Father's Day gifts") //  10 days before (2023-06-05)
      ],
      fathers,
      { now }
    );
    expect(result.occurrences).toBe(3);
    // Per-occurrence leads: 10, 14, 21 -> median 14.
    expect(result.typicalLeadDays).toBe(14);
    expect(result.earliestLeadDays).toBe(21);
  });

  it("narrows to a single occurrence year when one is requested", () => {
    const emails = [
      email("2024-05-22T09:00:00Z", "Father's Day gifts"), // 14 days before 2024
      email("2025-05-15T09:00:00Z", "Father's Day gifts"), // 21 days before 2025
      email("2025-06-02T09:00:00Z", "Father's Day this weekend") // 3 days before 2025
    ];
    const full = analyzeSeasonalRunup(emails, fathers, { now });
    expect(full.occurrences).toBe(2);
    expect(full.matchedCount).toBe(3);

    const scoped = analyzeSeasonalRunup(emails, fathers, { now, year: 2025 });
    expect(scoped.occurrences).toBe(1);
    expect(scoped.matchedCount).toBe(2);
    expect(scoped.earliestLeadDays).toBe(21);
    expect(scoped.emails.every((e) => e.eventYear === 2025)).toBe(true);
  });

  it("attributes a late-December teaser to the next New Year", () => {
    const result = analyzeSeasonalRunup(
      [email("2025-12-28T09:00:00Z", "Get ready for New Year")],
      event("new-year"),
      { now }
    );
    expect(result.matchedCount).toBe(1);
    expect(result.perOccurrence[0]).toMatchObject({ year: 2026, leadDays: 4 });
  });

  it("ignores matches outside every variant's look-ahead window", () => {
    // June 25 falls after both June Father's Days (DK June 5, US June 15)
    // and is >120 days before the Nordic November date -> dropped entirely.
    const result = analyzeSeasonalRunup(
      [email("2025-06-25T09:00:00Z", "Father's Day recap")],
      fathers,
      { now }
    );
    expect(result.matchedCount).toBe(0);
  });

  it("self-selects the US Father's Day date for a US brand's run-up", () => {
    // US Father's Day 2025 = 3rd Sunday of June = June 15. Emails timed to
    // it land AFTER the Danish June 5 anchor but must still be counted —
    // the run-up self-selects the variant capturing the most emails.
    const result = analyzeSeasonalRunup(
      [
        email("2025-06-01T09:00:00Z", "Father's Day gifts for dad"), // 14 before June 15
        email("2025-06-10T09:00:00Z", "Last chance: Father's Day"), //  5 before June 15
        email("2025-06-15T09:00:00Z", "Happy Father's Day") //           day of
      ],
      fathers,
      { now }
    );
    expect(result.matchedCount).toBe(3);
    expect(result.perOccurrence[0].eventDate).toBe("2025-06-15");
    expect(result.earliestLeadDays).toBe(14);
    expect(result.emails.every((e) => e.variantIndex === 1)).toBe(true);
  });
});

describe("countEventMentions", () => {
  it("counts every mention regardless of run-up window", () => {
    const count = countEventMentions(
      [
        { subject: "Father's Day recap", preheader: null, receivedAt: "2025-06-06T09:00:00Z" },
        { subject: "Father's Day is coming", preheader: null, receivedAt: "2025-05-15T09:00:00Z" },
        { subject: "Nothing here", preheader: null, receivedAt: "2025-01-01T09:00:00Z" }
      ],
      event("fathers-day")
    );
    expect(count).toBe(2);
  });
});

describe("upcomingOccurrence", () => {
  it("rolls a single-date event to next year once it passes", () => {
    expect(
      upcomingOccurrence(event("christmas"), new Date("2026-12-26T00:00:00Z"))
    ).toBe("2027-12-24");
    expect(
      upcomingOccurrence(event("christmas"), new Date("2026-03-01T00:00:00Z"))
    ).toBe("2026-12-24");
  });

  it("returns the nearest regional variant for multi-date events", () => {
    // Father's Day has several regional dates; from early March the next is
    // St Joseph's Day (March 19).
    expect(
      upcomingOccurrence(event("fathers-day"), new Date("2026-03-01T00:00:00Z"))
    ).toBe("2026-03-19");
    // After both June dates, the Nordic 2nd-Sunday-of-November date is next.
    expect(
      upcomingOccurrence(event("fathers-day"), new Date("2026-06-25T00:00:00Z"))
    ).toBe("2026-11-08");
  });
});

describe("event registry", () => {
  it("has unique ids and non-empty keyword sets", () => {
    const ids = new Set<string>();
    for (const ev of SEASONAL_EVENTS) {
      expect(ids.has(ev.id)).toBe(false);
      ids.add(ev.id);
      expect(ev.keywords.length).toBeGreaterThan(0);
      expect(ev.emoji.length).toBeGreaterThan(0);
    }
  });
});
