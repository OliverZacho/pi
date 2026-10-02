import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { resolveBrandHandle } from "@/lib/brand-db";

/**
 * Request-memoised handle→identity resolve, shared by the layout (which 404s
 * unknown handles), `generateMetadata` and the page body so the lookup runs
 * once per request. `getSupabaseAdmin` is a singleton, so keying on the
 * handle string is stable.
 */
export const resolveHandle = cache((handle: string) =>
  resolveBrandHandle(getSupabaseAdmin(), handle)
);
