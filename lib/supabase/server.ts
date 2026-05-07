import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function getSupabaseBrowserKeys() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or anon/publishable key");
  }
  return { url, anonKey };
}

export async function createClient() {
  const { url, anonKey } = getSupabaseBrowserKeys();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, _responseHeaders) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          /* Server Components cannot always set cookies; middleware refreshes session */
        }
      }
    }
  });
}
