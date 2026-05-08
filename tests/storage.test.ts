import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadMock = vi.fn();
const createSignedUrlMock = vi.fn();
const createSignedUrlsMock = vi.fn();

const fromMock = vi.fn().mockImplementation(() => ({
  upload: uploadMock,
  createSignedUrl: createSignedUrlMock,
  createSignedUrls: createSignedUrlsMock
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    storage: { from: fromMock }
  })
}));

import {
  EMAIL_ASSETS_BUCKET,
  EMAIL_HTML_BUCKET,
  getSignedAssets,
  getSignedHtml,
  mirrorRemoteImages,
  uploadEmailHtml
} from "@/lib/storage";

beforeEach(() => {
  uploadMock.mockReset();
  createSignedUrlMock.mockReset();
  createSignedUrlsMock.mockReset();
  fromMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("uploadEmailHtml", () => {
  it("writes html to email-html bucket using the email id and returns the path", async () => {
    uploadMock.mockResolvedValueOnce({ data: { path: "abc.html" }, error: null });

    const path = await uploadEmailHtml("abc", "<p>hi</p>");

    expect(path).toBe("abc.html");
    expect(fromMock).toHaveBeenCalledWith(EMAIL_HTML_BUCKET);
    expect(uploadMock).toHaveBeenCalledWith(
      "abc.html",
      "<p>hi</p>",
      expect.objectContaining({ contentType: expect.stringMatching(/text\/html/), upsert: true })
    );
  });

  it("throws when storage upload fails", async () => {
    uploadMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(uploadEmailHtml("abc", "<p>hi</p>")).rejects.toThrow(/boom/);
  });
});

describe("mirrorRemoteImages", () => {
  it("downloads images, hashes them, and stores them in email-assets", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "Content-Type": "image/png" }
      })
    );
    uploadMock.mockResolvedValueOnce({ data: { path: "x" }, error: null });

    const result = await mirrorRemoteImages("email-1", ["https://cdn.example.com/banner.png"]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith(EMAIL_ASSETS_BUCKET);
    expect(result.storedPaths).toHaveLength(1);
    expect(result.storedPaths[0]).toMatch(/^email-1\/[a-f0-9]{40}\.png$/);
    expect(result.failedUrls).toEqual([]);
  });

  it("collects errors when fetch fails and continues with other urls", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("dns"))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([9, 9, 9]), {
          status: 200,
          headers: { "Content-Type": "image/jpeg" }
        })
      );
    uploadMock.mockResolvedValueOnce({ data: { path: "y" }, error: null });

    const result = await mirrorRemoteImages("email-2", [
      "https://broken.example.com/a.png",
      "https://cdn.example.com/b.jpg"
    ]);

    expect(result.storedPaths).toHaveLength(1);
    expect(result.storedPaths[0]).toMatch(/^email-2\/[a-f0-9]{40}\.jpg$/);
    expect(result.failedUrls).toEqual([
      { url: "https://broken.example.com/a.png", reason: "dns" }
    ]);
  });

  it("dedupes duplicate URLs before fetching", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "image/png" }
        })
      );
    uploadMock.mockResolvedValue({ data: { path: "z" }, error: null });

    const result = await mirrorRemoteImages("email-3", [
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/a.png"
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.storedPaths).toHaveLength(1);
  });

  it("rejects images larger than the configured limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(new Uint8Array(0), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(20 * 1024 * 1024)
        }
      })
    );

    const result = await mirrorRemoteImages("email-4", ["https://cdn.example.com/big.png"]);

    expect(result.storedPaths).toEqual([]);
    expect(result.failedUrls[0].reason).toMatch(/too large/);
  });
});

describe("signed url helpers", () => {
  it("returns a signed url for getSignedHtml", async () => {
    createSignedUrlMock.mockResolvedValueOnce({
      data: { signedUrl: "https://signed.example.com/html" },
      error: null
    });

    expect(await getSignedHtml("abc.html")).toBe("https://signed.example.com/html");
  });

  it("returns null when getSignedHtml errors", async () => {
    createSignedUrlMock.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await getSignedHtml("abc.html")).toBeNull();
  });

  it("returns a path->url map for getSignedAssets", async () => {
    createSignedUrlsMock.mockResolvedValueOnce({
      data: [
        { path: "email-1/a.png", signedUrl: "https://signed.example.com/a" },
        { path: "email-1/b.png", signedUrl: "https://signed.example.com/b" }
      ],
      error: null
    });

    const map = await getSignedAssets(["email-1/a.png", "email-1/b.png"]);
    expect(map).toEqual({
      "email-1/a.png": "https://signed.example.com/a",
      "email-1/b.png": "https://signed.example.com/b"
    });
  });

  it("returns an empty object when given no paths", async () => {
    expect(await getSignedAssets([])).toEqual({});
    expect(createSignedUrlsMock).not.toHaveBeenCalled();
  });
});
