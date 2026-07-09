import { describe, expect, it } from "vitest";
import {
  buildOfferEpisodes,
  summarizeOfferDeadlines,
  type OfferEmail
} from "@/lib/offer-episodes";

let seq = 0;
function email(overrides: Partial<OfferEmail> & { receivedAt: string }): OfferEmail {
  seq += 1;
  return {
    id: `e${seq}`,
    discountPercent: 20,
    promoCode: null,
    offerEndsOn: null,
    offerIsExtension: null,
    ...overrides
  };
}

describe("buildOfferEpisodes", () => {
  it("ignores emails without a positive discount", () => {
    const episodes = buildOfferEpisodes([
      email({ receivedAt: "2026-06-01T09:00:00Z", discountPercent: null }),
      email({ receivedAt: "2026-06-02T09:00:00Z", discountPercent: 0 })
    ]);
    expect(episodes).toEqual([]);
  });

  it("groups reminder sends sharing a promo code into one episode", () => {
    const episodes = buildOfferEpisodes([
      email({ receivedAt: "2026-06-01T09:00:00Z", promoCode: "SUMMER20" }),
      email({ receivedAt: "2026-06-03T09:00:00Z", promoCode: "summer20" }),
      email({ receivedAt: "2026-06-07T09:00:00Z", promoCode: "SUMMER20" })
    ]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].emails).toHaveLength(3);
    expect(episodes[0].promoCode).toBe("SUMMER20");
  });

  it("treats a promo code resurfacing months later as a fresh episode", () => {
    const episodes = buildOfferEpisodes([
      email({ receivedAt: "2026-01-10T09:00:00Z", promoCode: "WELCOME10", discountPercent: 10 }),
      email({ receivedAt: "2026-06-10T09:00:00Z", promoCode: "WELCOME10", discountPercent: 10 })
    ]);
    expect(episodes).toHaveLength(2);
  });

  it("groups codeless same-depth sends only within the reminder gap", () => {
    const episodes = buildOfferEpisodes([
      email({ receivedAt: "2026-06-01T09:00:00Z" }),
      email({ receivedAt: "2026-06-03T09:00:00Z" }),
      email({ receivedAt: "2026-06-20T09:00:00Z" })
    ]);
    expect(episodes).toHaveLength(2);
    expect(episodes[0].emails).toHaveLength(2);
    expect(episodes[1].emails).toHaveLength(1);
  });

  it("never merges different depths, even back-to-back", () => {
    const episodes = buildOfferEpisodes([
      email({ receivedAt: "2026-06-01T09:00:00Z", discountPercent: 20 }),
      email({ receivedAt: "2026-06-02T09:00:00Z", discountPercent: 50 })
    ]);
    expect(episodes).toHaveLength(2);
  });

  it("keeps the first stated deadline as the original when reminders restate it", () => {
    const episodes = buildOfferEpisodes([
      email({ receivedAt: "2026-06-01T09:00:00Z", offerEndsOn: "2026-06-08" }),
      email({ receivedAt: "2026-06-05T09:00:00Z", offerEndsOn: "2026-06-08" })
    ]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].statedEndOn).toBe("2026-06-08");
    expect(episodes[0].extended).toBe(false);
    expect(episodes[0].extensionDays).toBe(0);
  });

  it("marks a later, larger stated end as an extension", () => {
    const episodes = buildOfferEpisodes([
      email({ receivedAt: "2026-06-01T09:00:00Z", offerEndsOn: "2026-06-07" }),
      email({
        receivedAt: "2026-06-08T09:00:00Z",
        offerEndsOn: "2026-06-12",
        offerIsExtension: true
      })
    ]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].statedEndOn).toBe("2026-06-07");
    expect(episodes[0].extended).toBe(true);
    expect(episodes[0].extendedUntilOn).toBe("2026-06-12");
    expect(episodes[0].extensionDays).toBe(5);
  });

  it("marks a quiet post-deadline send as an extension without new copy", () => {
    const episodes = buildOfferEpisodes([
      email({
        receivedAt: "2026-06-01T09:00:00Z",
        promoCode: "FLASH50",
        discountPercent: 50,
        offerEndsOn: "2026-06-03"
      }),
      email({
        receivedAt: "2026-06-05T09:00:00Z",
        promoCode: "FLASH50",
        discountPercent: 50
      })
    ]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].extended).toBe(true);
    expect(episodes[0].extendedUntilOn).toBe("2026-06-05");
    expect(episodes[0].extensionDays).toBe(2);
  });

  it("lets an explicit extension email rejoin across a longer quiet stretch", () => {
    const episodes = buildOfferEpisodes([
      email({ receivedAt: "2026-06-01T09:00:00Z", offerEndsOn: "2026-06-02" }),
      email({
        receivedAt: "2026-06-08T09:00:00Z",
        offerIsExtension: true,
        offerEndsOn: "2026-06-10"
      })
    ]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].extended).toBe(true);
    expect(episodes[0].extendedUntilOn).toBe("2026-06-10");
  });

  it("attaches a reminder to the most recent plausible episode, not an older one", () => {
    const episodes = buildOfferEpisodes([
      email({ receivedAt: "2026-05-01T09:00:00Z" }),
      email({ receivedAt: "2026-06-01T09:00:00Z" }),
      email({ receivedAt: "2026-06-02T09:00:00Z" })
    ]);
    expect(episodes).toHaveLength(2);
    expect(episodes[1].emails.map((e) => e.receivedAt)).toEqual([
      "2026-06-01T09:00:00Z",
      "2026-06-02T09:00:00Z"
    ]);
  });

  it("splits a same-depth send whose stated deadline jumps far past the episode's promise", () => {
    // Ferm Living pattern: 48h VIP preview with a stated deadline, then the
    // public sale opens next day at the same depth with a deadline weeks out.
    const episodes = buildOfferEpisodes([
      email({
        receivedAt: "2026-06-15T04:30:00Z",
        discountPercent: 50,
        promoCode: "VIPSUMMERSALE26"
      }),
      email({
        receivedAt: "2026-06-16T05:00:00Z",
        discountPercent: 50,
        promoCode: "VIPSUMMERSALE26",
        offerEndsOn: "2026-06-16"
      }),
      email({
        receivedAt: "2026-06-17T04:30:00Z",
        discountPercent: 50,
        offerEndsOn: "2026-07-12"
      }),
      email({
        receivedAt: "2026-06-21T05:30:00Z",
        discountPercent: 50,
        offerEndsOn: "2026-07-12"
      })
    ]);
    expect(episodes).toHaveLength(2);
    expect(episodes[0].emails).toHaveLength(2);
    expect(episodes[0].statedEndOn).toBe("2026-06-16");
    expect(episodes[0].extended).toBe(false);
    expect(episodes[1].emails).toHaveLength(2);
    expect(episodes[1].statedEndOn).toBe("2026-07-12");
    expect(episodes[1].extended).toBe(false);
  });

  it("keeps a small quiet deadline nudge in the episode as an extension", () => {
    const episodes = buildOfferEpisodes([
      email({ receivedAt: "2026-06-01T09:00:00Z", offerEndsOn: "2026-06-07" }),
      email({ receivedAt: "2026-06-08T09:00:00Z", offerEndsOn: "2026-06-12" })
    ]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].extended).toBe(true);
    expect(episodes[0].extendedUntilOn).toBe("2026-06-12");
    expect(episodes[0].extensionDays).toBe(5);
  });

  it("lets a shared promo code carry a deadline jump of any size", () => {
    const episodes = buildOfferEpisodes([
      email({
        receivedAt: "2026-06-01T09:00:00Z",
        promoCode: "SUMMER20",
        offerEndsOn: "2026-06-03"
      }),
      email({
        receivedAt: "2026-06-04T09:00:00Z",
        promoCode: "SUMMER20",
        offerEndsOn: "2026-06-30"
      })
    ]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].extended).toBe(true);
    expect(episodes[0].extendedUntilOn).toBe("2026-06-30");
  });

  it("keeps a send inside a long stated window in the episode despite a big gap", () => {
    const episodes = buildOfferEpisodes([
      email({ receivedAt: "2026-06-01T09:00:00Z", offerEndsOn: "2026-06-20" }),
      email({ receivedAt: "2026-06-15T09:00:00Z" })
    ]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].extended).toBe(false);
  });
});

describe("summarizeOfferDeadlines", () => {
  it("splits offers into deadline kinds, leaving live offers unjudged", () => {
    const episodes = buildOfferEpisodes([
      // Ended on time.
      email({ receivedAt: "2026-05-01T09:00:00Z", offerEndsOn: "2026-05-03" }),
      // Extended.
      email({
        receivedAt: "2026-06-01T09:00:00Z",
        discountPercent: 50,
        offerEndsOn: "2026-06-03"
      }),
      email({
        receivedAt: "2026-06-05T09:00:00Z",
        discountPercent: 50,
        offerIsExtension: true
      }),
      // Still live at `today` below.
      email({
        receivedAt: "2026-07-01T09:00:00Z",
        discountPercent: 60,
        offerEndsOn: "2026-07-10"
      }),
      // No stated deadline at all.
      email({ receivedAt: "2026-04-01T09:00:00Z", discountPercent: 15 })
    ]);
    const summary = summarizeOfferDeadlines(episodes, "2026-07-06");
    expect(summary).toEqual({ withDeadline: 3, endedOnTime: 1, extended: 1 });
  });
});
