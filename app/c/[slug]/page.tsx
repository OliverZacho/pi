import { notFound } from "next/navigation";
import {
  getCollectionBySlugPublic,
  type CollectionDetail
} from "@/lib/collections-db";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import PublicCollectionClient from "@/components/collections/PublicCollectionClient";
import publicStyles from "@/components/collections/public-collection.module.css";

const SLUG_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  if (!SLUG_PATTERN.test(slug)) {
    return { title: "Collection — Pirol" };
  }
  try {
    const detail = await getCollectionBySlugPublic(getSupabaseAdmin(), slug);
    if (detail) {
      return {
        title: `${detail.name} — Pirol`,
        description: `A shared Pirol collection of ${detail.emails.length} marketing emails.`
      };
    }
  } catch {
    /* metadata is best-effort */
  }
  return { title: "Collection — Pirol" };
}

/**
 * `/c/[slug]` — the **publicly accessible** share view of a collection.
 *
 * The page is intentionally unauthenticated: anyone with the link can
 * load it. The whole shell sits outside `ExploreSidebar` so anonymous
 * visitors don't see the app chrome (sidebar, settings, etc.) — they
 * get a focused "look at this curated set" surface, branded but
 * read-only.
 */
export default async function PublicCollectionPage({ params }: PageProps) {
  const { slug } = await params;
  if (!SLUG_PATTERN.test(slug)) {
    notFound();
  }

  let collection: CollectionDetail | null = null;
  try {
    collection = await getCollectionBySlugPublic(getSupabaseAdmin(), slug);
  } catch (err) {
    console.error("Failed to load public collection", err);
  }

  if (!collection) {
    notFound();
  }

  return (
    <div className={publicStyles.shell}>
      <PublicCollectionClient collection={collection} slug={slug} />
    </div>
  );
}
