import { describe, expect, it } from "vitest";
import {
  followActivityNoticeId,
  saveUsageNotice,
  websiteHost
} from "@/lib/sidebar-notices";

/**
 * Pure pieces of the sidebar-footer notice system: the save-cap copy
 * thresholds, the dismissal-key derivation for follow activity, and the
 * website→domain normalization used to match fulfilled brand requests
 * against `companies.domain`.
 */
const LIMIT = 25;

describe("saveUsageNotice", () => {
  it("shows plain progress copy well under the cap", () => {
    const notice = saveUsageNotice(18, LIMIT);
    expect(notice.title).toBe("18 of 25 free saves used");
    expect(notice.progress).toEqual({ count: 18, limit: LIMIT });
    expect(notice.dismissible).toBe(false);
    expect(notice.cta?.href).toBe("/pricing");
  });

  it("switches to urgency copy inside the warning window", () => {
    // 20 saved leaves 5 — the first count inside the window.
    expect(saveUsageNotice(20, LIMIT).title).toBe("Only 5 free saves left");
    expect(saveUsageNotice(24, LIMIT).title).toBe("Only 1 free save left");
  });

  it("announces the cap once every save is used", () => {
    const notice = saveUsageNotice(25, LIMIT);
    expect(notice.title).toBe("You've used all 25 free saves");
    expect(notice.progress).toEqual({ count: 25, limit: LIMIT });
  });

  it("clamps an over-cap count so the bar never overflows", () => {
    // Counts above the limit can exist (cap lowered, legacy rows).
    expect(saveUsageNotice(30, LIMIT).progress).toEqual({
      count: 25,
      limit: LIMIT
    });
  });
});

describe("followActivityNoticeId", () => {
  it("keys on the newest email's calendar day", () => {
    expect(followActivityNoticeId("2026-06-10T14:30:00.000Z")).toBe(
      "follow-activity:2026-06-10"
    );
  });

  it("stays stable across same-day arrivals so a dismissal holds", () => {
    expect(followActivityNoticeId("2026-06-10T08:00:00.000Z")).toBe(
      followActivityNoticeId("2026-06-10T23:59:59.000Z")
    );
  });
});

describe("websiteHost", () => {
  it("normalizes a full URL down to the bare host", () => {
    expect(websiteHost("https://www.nike.com/launch")).toBe("nike.com");
  });

  it("accepts scheme-less input the request form allows", () => {
    expect(websiteHost("nike.com")).toBe("nike.com");
    expect(websiteHost("WWW.Nike.com")).toBe("nike.com");
  });

  it("returns null for unparseable input", () => {
    expect(websiteHost("")).toBeNull();
    expect(websiteHost("   ")).toBeNull();
    expect(websiteHost("http://")).toBeNull();
  });
});
