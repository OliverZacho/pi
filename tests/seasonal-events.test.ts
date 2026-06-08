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
  it("computes Danish floating holidays for known years", () => {
    // Father's Day is fixed June 5 in Denmark.
    expect(event("fathers-day").dateForYear(2025)).toEqual({ month: 6, day: 5 });
    // Mother's Day: 2nd Sunday of May 2025 = May 11.
    expect(event("mothers-day").dateForYear(2025)).toEqual({ month: 5, day: 11 });
    // Black Friday: 4th Friday of November 2025 = Nov 28.
    expect(event("black-friday").dateForYear(2025)).toEqual({ month: 11, day: 28 });
    // Easter Sunday 2025 = April 20.
    expect(event("easter").dateForYear(2025)).toEqual({ month: 4, day: 20 });
    // Easter Sunday 2024 = March 31.
    expect(event("easter").dateForYear(2024)).toEqual({ month: 3, day: 31 });
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

  it("attributes a late-December teaser to the next New Year", () => {
    const result = analyzeSeasonalRunup(
      [email("2025-12-28T09:00:00Z", "Get ready for New Year")],
      event("new-year"),
      { now }
    );
    expect(result.matchedCount).toBe(1);
    expect(result.perOccurrence[0]).toMatchObject({ year: 2026, leadDays: 4 });
  });

  it("ignores matches outside the look-ahead window", () => {
    // A 'Father's Day' email sent the day after the event maps to next
    // year's occurrence, which is ~364 days out -> dropped.
    const result = analyzeSeasonalRunup(
      [email("2025-06-06T09:00:00Z", "Father's Day recap")],
      fathers,
      { now }
    );
    expect(result.matchedCount).toBe(0);
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
  it("rolls to next year once the date has passed", () => {
    // Father's Day June 5; from June 8 the upcoming one is next year.
    expect(upcomingOccurrence(event("fathers-day"), new Date("2026-06-08T00:00:00Z"))).toBe(
      "2027-06-05"
    );
    expect(upcomingOccurrence(event("fathers-day"), new Date("2026-03-01T00:00:00Z"))).toBe(
      "2026-06-05"
    );
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
