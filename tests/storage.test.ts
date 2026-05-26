import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The CDN short-circuit in `getSignedAssets` is gated by a
// module-load-time env var. Keep it unset for the default suite;
// the dedicated `getSignedAssets with NEXT_PUBLIC_ASSET_CDN_URL`
// block flips it via `vi.resetModules` so it can re-import the
// module with the env in place.
delete process.env.NEXT_PUBLIC_ASSET_CDN_URL;

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
  __resetSignedUrlCacheForTests,
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
  // The signed-URL helpers memoise per-process so the same path returns
  // the same URL across calls (which is the whole point — it lets the
  // browser cache do its job). Reset between tests so cases that re-use
  // the same storage path see a clean slate and don't unexpectedly hit
  // the cache populated by an earlier test.
  __resetSignedUrlCacheForTests();
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
  it("downloads images, hashes them, and stores them at the bucket root", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "Content-Type": "image/png" }
      })
    );
    uploadMock.mockResolvedValueOnce({ data: { path: "x" }, error: null });

    const result = await mirrorRemoteImages(["https://cdn.example.com/banner.png"]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith(EMAIL_ASSETS_BUCKET);
    expect(result.storedPaths).toHaveLength(1);
    // No leading folder segment — the SHA-1 alone names the object
    // so the same image content embedded in any other email lands
    // at the same path and dedupes via `upsert: true`.
    expect(result.storedPaths[0]).toMatch(/^[a-f0-9]{40}\.png$/);
    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{40}\.png$/),
      expect.any(Uint8Array),
      expect.objectContaining({ upsert: true })
    );
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

    const result = await mirrorRemoteImages([
      "https://broken.example.com/a.png",
      "https://cdn.example.com/b.jpg"
    ]);

    expect(result.storedPaths).toHaveLength(1);
    expect(result.storedPaths[0]).toMatch(/^[a-f0-9]{40}\.jpg$/);
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

    const result = await mirrorRemoteImages([
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/a.png"
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.storedPaths).toHaveLength(1);
  });

  it("dedupes different URLs that return identical bytes by SHA-1", async () => {
    // URL-level dedup (above) only catches obviously-duplicate
    // links in the email body. The bigger win is content-level
    // dedup: two distinct hosts serving the same image (e.g.
    // mirrored CDNs) collapse to a single storage object because
    // both fetches produce the same SHA-1 of the bytes.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([7, 7, 7]), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" }
      })
    );
    uploadMock.mockResolvedValue({ data: { path: "z" }, error: null });

    const result = await mirrorRemoteImages([
      "https://cdn-a.example.com/a.jpg",
      "https://cdn-b.example.com/a.jpg"
    ]);

    expect(result.storedPaths).toHaveLength(1);
    expect(uploadMock).toHaveBeenCalledTimes(1);
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

    const result = await mirrorRemoteImages(["https://cdn.example.com/big.png"]);

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

  it("ignores the transform option and signs every path without transformation", async () => {
    // Image transformations are disabled at the storage layer (see
    // the comment in `getSignedAssets`) because Supabase meters them
    // per unique (path, transform) pair and we blew past the
    // included quota. Until the kill switch flips back on, callers
    // can still pass `transform: ...` for forward-compat, but every
    // path must go through a single un-transformed `createSignedUrls`
    // batch — no `createSignedUrl` with `{ transform }`, no per-path
    // fan-out.
    createSignedUrlsMock.mockResolvedValueOnce({
      data: [
        { path: "email-1/hero.png", signedUrl: "https://signed.example.com/png" },
        { path: "email-1/logo.svg", signedUrl: "https://signed.example.com/svg" },
        { path: "email-1/fav.ico", signedUrl: "https://signed.example.com/ico" }
      ],
      error: null
    });

    const map = await getSignedAssets(
      ["email-1/hero.png", "email-1/logo.svg", "email-1/fav.ico"],
      { transform: { width: 600, quality: 70 } }
    );

    expect(map).toEqual({
      "email-1/hero.png": "https://signed.example.com/png",
      "email-1/logo.svg": "https://signed.example.com/svg",
      "email-1/fav.ico": "https://signed.example.com/ico"
    });

    expect(createSignedUrlMock).not.toHaveBeenCalled();
    expect(createSignedUrlsMock).toHaveBeenCalledTimes(1);
    expect(createSignedUrlsMock).toHaveBeenCalledWith(
      ["email-1/hero.png", "email-1/logo.svg", "email-1/fav.ico"],
      expect.any(Number)
    );
  });
});

describe("getSignedAssets with NEXT_PUBLIC_ASSET_CDN_URL", () => {
  // These tests exercise the public-CDN short-circuit, which is
  // gated by a module-load-time env var. `vi.resetModules` makes the
  // dynamic `import()` below re-evaluate `lib/storage.ts` with the
  // env var in place, so we don't have to plumb the value through a
  // setter on the production module.
  const realEnv = process.env.NEXT_PUBLIC_ASSET_CDN_URL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (realEnv === undefined) {
      delete process.env.NEXT_PUBLIC_ASSET_CDN_URL;
    } else {
      process.env.NEXT_PUBLIC_ASSET_CDN_URL = realEnv;
    }
    vi.resetModules();
  });

  it("returns public CDN URLs and never calls createSignedUrls", async () => {
    process.env.NEXT_PUBLIC_ASSET_CDN_URL = "https://cdn.pirol.app";
    const storage = await import("@/lib/storage");

    const map = await storage.getSignedAssets([
      "email-1/aaa.png",
      "email-1/bbb.jpg"
    ]);

    expect(map).toEqual({
      "email-1/aaa.png":
        "https://cdn.pirol.app/storage/v1/object/public/email-assets/email-1/aaa.png",
      "email-1/bbb.jpg":
        "https://cdn.pirol.app/storage/v1/object/public/email-assets/email-1/bbb.jpg"
    });
    expect(createSignedUrlsMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("ignores a trailing slash on the env var", async () => {
    process.env.NEXT_PUBLIC_ASSET_CDN_URL = "https://cdn.pirol.app//";
    const storage = await import("@/lib/storage");

    const map = await storage.getSignedAssets(["email-1/x.png"]);

    // Single slash between origin and path — would otherwise hit a
    // double-slash URL that Supabase happens to accept today but
    // would be a subtle hazard for future cache-key rules at the
    // edge.
    expect(map["email-1/x.png"]).toBe(
      "https://cdn.pirol.app/storage/v1/object/public/email-assets/email-1/x.png"
    );
  });

  it("still returns {} for an empty input even when the CDN is configured", async () => {
    process.env.NEXT_PUBLIC_ASSET_CDN_URL = "https://cdn.pirol.app";
    const storage = await import("@/lib/storage");

    expect(await storage.getSignedAssets([])).toEqual({});
    expect(createSignedUrlsMock).not.toHaveBeenCalled();
  });
});
