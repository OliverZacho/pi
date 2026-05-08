import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyMock = vi.fn();
const insertSelectSingleMock = vi.fn();
const insertChain = {
  insert: vi.fn().mockImplementation(() => ({
    select: vi.fn().mockImplementation(() => ({
      single: insertSelectSingleMock
    }))
  }))
};

const eqMock = vi.fn();
const maybeSingleMock = vi.fn();
const selectMock = vi.fn().mockImplementation(() => ({
  eq: eqMock.mockImplementation(() => ({
    maybeSingle: maybeSingleMock
  }))
}));

const fromMock = vi.fn().mockImplementation(() => ({
  select: selectMock,
  insert: insertChain.insert
}));

vi.mock("@/lib/resend", () => ({
  getResend: () => ({
    webhooks: { verify: verifyMock }
  }),
  getResendWebhookSecret: () => "secret"
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: fromMock
  })
}));

import { POST } from "@/app/api/webhooks/resend/route";

function buildRequest(body: Record<string, unknown>, overrides: Record<string, string> = {}) {
  return new Request("https://pirol.app/api/webhooks/resend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": "msg_123",
      "svix-timestamp": "1700000000",
      "svix-signature": "v1,abc",
      ...overrides
    },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  verifyMock.mockReset();
  insertSelectSingleMock.mockReset();
  insertChain.insert.mockClear();
  selectMock.mockClear();
  eqMock.mockClear();
  maybeSingleMock.mockReset();
  fromMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/resend", () => {
  it("rejects requests missing Svix headers", async () => {
    const response = await POST(
      new Request("https://pirol.app/api/webhooks/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      })
    );
    expect(response.status).toBe(400);
  });

  it("rejects requests with an invalid signature", async () => {
    verifyMock.mockImplementation(() => {
      throw new Error("bad signature");
    });

    const response = await POST(buildRequest({ type: "email.received" }));
    expect(response.status).toBe(401);
  });

  it("returns 202 with deduplicated:true when the event already exists", async () => {
    verifyMock.mockReturnValue({
      type: "email.received",
      created_at: "now",
      data: { email_id: "em_1", from: "x@y.com", to: ["a@b.com"], subject: "hi" }
    });
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "row-existing", status: "processed" },
      error: null
    });

    const response = await POST(buildRequest({}));
    expect(response.status).toBe(202);

    const body = await response.json();
    expect(body).toMatchObject({
      received: true,
      eventId: "row-existing",
      deduplicated: true,
      status: "processed"
    });
    expect(insertChain.insert).not.toHaveBeenCalled();
  });

  it("inserts a new webhook_events row for email.received and returns 202", async () => {
    verifyMock.mockReturnValue({
      type: "email.received",
      created_at: "now",
      data: { email_id: "em_2", from: "x@y.com", to: ["a@b.com"], subject: "hi" }
    });
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    insertSelectSingleMock.mockResolvedValueOnce({ data: { id: "row-new" }, error: null });

    const response = await POST(buildRequest({}));
    expect(response.status).toBe(202);

    const body = await response.json();
    expect(body).toEqual({ received: true, eventId: "row-new" });

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "resend",
        svix_id: "msg_123",
        event_type: "email.received",
        status: "received"
      })
    );
  });

  it("logs and skips events with an unsupported type", async () => {
    verifyMock.mockReturnValue({
      type: "email.delivered",
      created_at: "now",
      data: { email_id: "em_3", from: "x@y.com", to: ["a@b.com"], subject: "hi" }
    });
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    insertSelectSingleMock.mockResolvedValueOnce({ data: { id: "row-skipped" }, error: null });

    const response = await POST(buildRequest({}));
    expect(response.status).toBe(202);

    const body = await response.json();
    expect(body).toEqual({ ignored: "email.delivered", eventId: "row-skipped" });

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped", event_type: "email.delivered" })
    );
  });
});
