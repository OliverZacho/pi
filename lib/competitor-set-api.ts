import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

/**
 * An owner-scoped competitor-set write matched no rows. Team-shared
 * sets are readable by non-owners, so for them "not found" is
 * misleading; check whether the viewer can at least read the row
 * (RLS-scoped, so this never reveals sets the viewer couldn't already
 * see) and answer 403 read-only instead of 404.
 */
export async function competitorSetWriteFailure(
  supabase: SupabaseClient<Database>,
  setId: string
) {
  try {
    const { data } = await supabase
      .from("competitor_sets")
      .select("id")
      .eq("id", setId)
      .maybeSingle();
    if (data) {
      return NextResponse.json(
        {
          error:
            "This comparison is shared with you as read-only. Only its owner can edit it."
        },
        { status: 403 }
      );
    }
  } catch (error) {
    console.error("Failed to check comparison readability", error);
  }
  return NextResponse.json({ error: "Set not found" }, { status: 404 });
}
