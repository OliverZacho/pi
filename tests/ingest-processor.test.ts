import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const updateEqMock = vi.fn();
  const updateMock = vi.fn().mockImplementation(() => ({ eq: updateEqMock }));

  const dedupMaybeSingleMock = vi.fn();
  const dedupEqMock = vi.fn().mockImplementation(() => ({ maybeSingle: dedupMaybeSingleMock }));
  const selectMock = vi.fn().mockImplementation(() => ({ eq: dedupEqMock }));

  const fromMock = vi.fn().mockImplementation(() => ({
    update: updateMock,
    select: selectMock
  }));

  return {
    rpcMock: vi.fn(),
    updateMock,
    updateEqMock,
    selectMock,
    dedupMaybeSingleMock,
    fromMock,
    receivingGetMock: vi.fn(),
    uploadEmailHtmlMock: vi.fn(),
    mirrorRemoteImagesMock: vi.fn(),
    classifyEmailMock: vi.fn(),
    storeProcessedEmailMock: vi.fn()
  };
});

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    rpc: mocks.rpcMock,
    from: mocks.fromMock
  })
}));

vi.mock("@/lib/resend", () => ({
  getResend: () => ({
    emails: { receiving: { get: mocks.receivingGetMock } }
  })
}));

vi.mock("@/lib/storage", () => ({
  uploadEmailHtml: mocks.uploadEmailHtmlMock,
  mirrorRemoteImages: mocks.mirrorRemoteImagesMock
}));

vi.mock("@/lib/classify", () => ({
  classifyEmail: mocks.classifyEmailMock
}));

vi.mock("@/lib/admin-db", () => ({
  storeProcessedEmail: mocks.storeProcessedEmailMock
}));

import { processNextBatch } from "@/lib/ingest-processor";

beforeEach(() => {
  mocks.rpcMock.mockReset();
  mocks.updateMock.mockClear();
  mocks.updateEqMock.mockReset();
  mocks.selectMock.mockClear();
  mocks.dedupMaybeSingleMock.mockReset();
  mocks.fromMock.mockClear();
  mocks.receivingGetMock.mockReset();
  mocks.uploadEmailHtmlMock.mockReset();
  mocks.mirrorRemoteImagesMock.mockReset();
  mocks.classifyEmailMock.mockReset();
  mocks.storeProcessedEmailMock.mockReset();

  mocks.updateEqMock.mockResolvedValue({ data: null, error: null });
  mocks.dedupMaybeSingleMock.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processNextBatch", () => {
  it("returns claimed:0 when there are no events to process", async () => {
    mocks.rpcMock.mockResolvedValueOnce({ data: [], error: null });

    const result = await processNextBatch();

    expect(mocks.rpcMock).toHaveBeenCalledWith("claim_webhook_events", { batch_limit: 5 });
    expect(result).toEqual({
      claimed: 0,
      processed: 0,
      failed: 0,
      skipped: 0,
      outcomes: []
    });
  });

  it("processes a happy-path email.received event through the pipeline", async () => {
    mocks.rpcMock.mockResolvedValueOnce({
      data: [
        {
          id: "evt-1",
          source: "resend",
          svix_id: "msg_1",
          event_type: "email.received",
          status: "processing",
          attempt_count: 1,
          payload: {
            type: "email.received",
            created_at: "2026-05-07T00:00:00Z",
            data: {
              email_id: "em_1",
              from: "sender@example.com",
              to: ["nike-20260507@pirol.app"],
              subject: "hi"
            }
          }
        }
      ],
      error: null
    });

    mocks.receivingGetMock.mockResolvedValueOnce({
      data: {
        id: "em_1",
        from: "sender@example.com",
        to: ["nike-20260507@pirol.app"],
        cc: [],
        bcc: [],
        subject: "Big launch!",
        html: '<p>hi</p><img src="https://cdn.example.com/banner.png" />',
        text: "hi",
        created_at: "2026-05-07T00:00:00Z"
      },
      error: null
    });
    mocks.uploadEmailHtmlMock.mockResolvedValueOnce("em_1.html");
    mocks.mirrorRemoteImagesMock.mockResolvedValueOnce({
      storedPaths: ["em_1/abc.png"],
      stored: [
        {
          remoteUrl: "https://cdn.example.com/banner.png",
          storagePath: "em_1/abc.png",
          contentType: "image/png",
          byteLength: 100
        }
      ],
      failedUrls: []
    });
    mocks.classifyEmailMock.mockResolvedValueOnce({
      category: "product_launch",
      confidence: 0.92,
      source: "llm",
      model: "gpt-4o-mini",
      reasoning: "Mentions launch.",
      discountPercent: null,
      discountAmount: null,
      currency: null,
      promoCode: null,
      primaryCtaText: "Read more",
      primaryCtaUrlHint: null
    });
    mocks.storeProcessedEmailMock.mockResolvedValueOnce({ id: "email-row-1", deduplicated: false });

    const result = await processNextBatch();

    expect(result.claimed).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.outcomes[0]).toMatchObject({
      eventId: "evt-1",
      status: "processed",
      emailId: "email-row-1",
      deduplicated: false
    });

    expect(mocks.uploadEmailHtmlMock).toHaveBeenCalledWith("em_1", expect.any(String));
    expect(mocks.mirrorRemoteImagesMock).toHaveBeenCalledWith("em_1", [
      "https://cdn.example.com/banner.png"
    ]);
    expect(mocks.storeProcessedEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resendId: "em_1",
        htmlStoragePath: "em_1.html",
        imageStoragePaths: ["em_1/abc.png"],
        classification: expect.objectContaining({ category: "product_launch", source: "llm" }),
        enrichment: expect.objectContaining({
          hasGif: false,
          hasDarkMode: false
        })
      })
    );

    const storeArgs = mocks.storeProcessedEmailMock.mock.calls[0][0];
    expect(storeArgs.enrichment.metadata.image_mirror_map).toEqual({
      "https://cdn.example.com/banner.png": "em_1/abc.png"
    });

    expect(mocks.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processed", last_error: null })
    );
  });

  it("marks the event failed when fetching from Resend errors", async () => {
    mocks.rpcMock.mockResolvedValueOnce({
      data: [
        {
          id: "evt-2",
          source: "resend",
          svix_id: "msg_2",
          event_type: "email.received",
          status: "processing",
          attempt_count: 1,
          payload: {
            type: "email.received",
            created_at: "2026-05-07T00:00:00Z",
            data: {
              email_id: "em_2",
              from: "sender@example.com",
              to: ["x@pirol.app"],
              subject: "hi"
            }
          }
        }
      ],
      error: null
    });
    mocks.receivingGetMock.mockResolvedValueOnce({
      data: null,
      error: { message: "resend down" }
    });

    const result = await processNextBatch();

    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
    expect(result.outcomes[0].status).toBe("failed");
    expect(result.outcomes[0].error).toMatch(/resend down/);

    expect(mocks.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", last_error: expect.stringMatching(/resend down/) })
    );
  });

  it("skips events whose payload is not email.received", async () => {
    mocks.rpcMock.mockResolvedValueOnce({
      data: [
        {
          id: "evt-3",
          source: "resend",
          svix_id: "msg_3",
          event_type: "email.delivered",
          status: "processing",
          attempt_count: 1,
          payload: {
            type: "email.delivered",
            created_at: "2026-05-07T00:00:00Z",
            data: { email_id: "em_3", from: "x", to: [], subject: "x" }
          }
        }
      ],
      error: null
    });

    const result = await processNextBatch();

    expect(result.skipped).toBe(1);
    expect(result.outcomes[0].status).toBe("skipped");
    expect(mocks.receivingGetMock).not.toHaveBeenCalled();
    expect(mocks.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped", last_error: expect.stringMatching(/email.delivered/) })
    );
  });
});
