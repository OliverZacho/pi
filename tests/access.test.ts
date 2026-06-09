import { describe, expect, it } from "vitest";
import { resolveViewer } from "@/lib/access";
import { isCuratedEmail } from "@/lib/explore-db";

/**
 * Minimal fake of the Supabase client surface these helpers touch:
 *  - `auth.getClaims()` (local JWT verification)
 *  - `from(table).select().eq().is().maybeSingle()`
 *  - `rpc()`
 *
 * Each `from(table)` returns a chainable builder whose terminal
 * `maybeSingle()` resolves to the preset result for that table, so a
 * test can describe the DB state declaratively without a real client.
 */
type TableResult = { data: unknown; error: unknown };

function makeClient(opts: {
  claims?: { sub: string; email?: string } | null;
  tables?: Record<string, TableResult>;
  /** Value returned by the `has_archive_access()` RPC. */
  access?: boolean;
}) {
  const tables = opts.tables ?? {};
  return {
    auth: {
      getClaims: async () => ({
        data: opts.claims ? { claims: opts.claims } : null,
        error: null
      })
    },
    rpc: async (_name: string) => ({ data: opts.access ?? false, error: null }),
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.is = chain;
      builder.maybeSingle = async () =>
        tables[table] ?? { data: null, error: null };
      return builder;
    }
  } as unknown as Parameters<typeof resolveViewer>[0];
}

describe("resolveViewer", () => {
  it("returns null when nobody is signed in", async () => {
    expect(await resolveViewer(makeClient({ claims: null }))).toBeNull();
  });

  it("returns null when the JWT carries no subject", async () => {
    const client = makeClient({
      claims: { email: "x@y.z" } as { sub: string; email?: string }
    });
    expect(await resolveViewer(client)).toBeNull();
  });

  it("marks an admin as isAdmin + hasAccess", async () => {
    const client = makeClient({
      claims: { sub: "u1", email: "a@test.dev" },
      tables: { admin_users: { data: { user_id: "u1" }, error: null } },
      access: false // admin still gets access via isAdmin, independent of the RPC
    });
    expect(await resolveViewer(client)).toEqual({
      userId: "u1",
      email: "a@test.dev",
      isAdmin: true,
      hasAccess: true
    });
  });

  it("grants hasAccess to a non-admin with an active subscription", async () => {
    const client = makeClient({
      claims: { sub: "u2" },
      tables: { admin_users: { data: null, error: null } },
      access: true
    });
    expect(await resolveViewer(client)).toEqual({
      userId: "u2",
      email: null,
      isAdmin: false,
      hasAccess: true
    });
  });

  it("denies a non-admin with no subscription (no free tier)", async () => {
    const client = makeClient({
      claims: { sub: "u3" },
      tables: { admin_users: { data: null, error: null } },
      access: false
    });
    expect(await resolveViewer(client)).toEqual({
      userId: "u3",
      email: null,
      isAdmin: false,
      hasAccess: false
    });
  });
});

describe("isCuratedEmail", () => {
  const EMAIL = "11111111-1111-4111-8111-111111111111";

  it("is true when the email's brand is curated", async () => {
    const client = makeClient({
      tables: {
        captured_emails: { data: { company_id: "c1" }, error: null },
        companies: { data: { id: "c1" }, error: null }
      }
    });
    expect(await isCuratedEmail(client, EMAIL)).toBe(true);
  });

  it("is false when the brand is not curated", async () => {
    const client = makeClient({
      tables: {
        captured_emails: { data: { company_id: "c1" }, error: null },
        // companies query filters on is_curated=true, so a non-curated
        // brand resolves to no row.
        companies: { data: null, error: null }
      }
    });
    expect(await isCuratedEmail(client, EMAIL)).toBe(false);
  });

  it("is false when the email has no company", async () => {
    const client = makeClient({
      tables: {
        captured_emails: { data: { company_id: null }, error: null }
      }
    });
    expect(await isCuratedEmail(client, EMAIL)).toBe(false);
  });

  it("is false when the email does not exist", async () => {
    const client = makeClient({
      tables: { captured_emails: { data: null, error: null } }
    });
    expect(await isCuratedEmail(client, EMAIL)).toBe(false);
  });
});
