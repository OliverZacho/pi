import { describe, expect, it } from "vitest";
import { classifyListHeaders } from "@/lib/admin-types";

describe("classifyListHeaders", () => {
  it("returns 'unknown' when no header snapshot was captured", () => {
    const verdict = classifyListHeaders(null);
    expect(verdict.level).toBe("unknown");
    expect(verdict.apple_mail_button).toBe(false);
    expect(verdict.gmail_yahoo_one_click).toBe(false);
  });

  it("returns 'missing' when List-Unsubscribe header is absent", () => {
    const verdict = classifyListHeaders({
      has_list_unsubscribe: false,
      unsubscribe_mailto: null,
      unsubscribe_url: null,
      has_one_click_post: false,
      list_id: null
    });
    expect(verdict.level).toBe("missing");
    expect(verdict.apple_mail_button).toBe(false);
    expect(verdict.gmail_yahoo_one_click).toBe(false);
  });

  it("returns 'compliant' when https URL + List-Unsubscribe-Post are both present", () => {
    const verdict = classifyListHeaders({
      has_list_unsubscribe: true,
      unsubscribe_mailto: "mailto:u@b.example",
      unsubscribe_url: "https://b.example/u",
      has_one_click_post: true,
      list_id: null
    });
    expect(verdict.level).toBe("compliant");
    expect(verdict.apple_mail_button).toBe(true);
    expect(verdict.gmail_yahoo_one_click).toBe(true);
  });

  it("returns 'missing_post_header' when only the post header is missing", () => {
    const verdict = classifyListHeaders({
      has_list_unsubscribe: true,
      unsubscribe_mailto: null,
      unsubscribe_url: "https://b.example/u",
      has_one_click_post: false,
      list_id: null
    });
    expect(verdict.level).toBe("missing_post_header");
    expect(verdict.apple_mail_button).toBe(true);
    expect(verdict.gmail_yahoo_one_click).toBe(false);
  });

  it("returns 'missing_https_url' when post header is set but List-Unsubscribe lacks an https URI", () => {
    const verdict = classifyListHeaders({
      has_list_unsubscribe: true,
      unsubscribe_mailto: "mailto:u@b.example",
      unsubscribe_url: null,
      has_one_click_post: true,
      list_id: null
    });
    expect(verdict.level).toBe("missing_https_url");
    expect(verdict.apple_mail_button).toBe(true);
    expect(verdict.gmail_yahoo_one_click).toBe(false);
  });

  it("returns 'mailto_only' for the older RFC 2369 mechanism", () => {
    const verdict = classifyListHeaders({
      has_list_unsubscribe: true,
      unsubscribe_mailto: "mailto:u@b.example",
      unsubscribe_url: null,
      has_one_click_post: false,
      list_id: null
    });
    expect(verdict.level).toBe("mailto_only");
    expect(verdict.apple_mail_button).toBe(true);
    expect(verdict.gmail_yahoo_one_click).toBe(false);
  });
});
