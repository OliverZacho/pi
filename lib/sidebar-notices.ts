import type { Viewer } from "@/lib/access";
import { FREE_SAVE_LIMIT } from "@/lib/access";
import type { PirolSupabaseClient } from "@/lib/supabase-admin";
import { countSavedEmails } from "@/lib/saved-emails-db";
import { listFollowedBrandIds } from "@/lib/follows-db";
import { listHandledBrandRequestsForUser } from "@/lib/brand-requests-db";
import { getTeamForUser } from "@/lib/teams-db";

/**
 * Notices rendered in the sidebar footer slot (above the account row).
 * The server returns them in priority order; the client shows the first
 * one the user hasn't dismissed. Dismissals live in localStorage keyed
 * by `id`, so ids must stay stable for the lifetime of a notice and
 * change when the notice should resurface (e.g. new emails arrived).
 */
export type SidebarNotice = {
  id: string;
  kind: "save-usage" | "brand-request" | "team-joined" | "follow-activity";
  title: string;
  /** Muted second line under the title, or `null` for title-only. */
  detail: string | null;
  cta: { label: string; href: string } | null;
  /** Dismissible notices show an ✕; persistent ones (the save cap) don't. */
  dismissible: boolean;
  /** Drives the progress bar on the free save-usage card. */
  progress?: { count: number; limit: number };
};

/** How close to the cap the copy switches to "only N left" urgency. */
export const SAVE_CAP_WARNING_WINDOW = 5;

/** Handled brand requests older than this stop producing notices. */
const BRAND_REQUEST_WINDOW_DAYS = 30;

/** "You've joined <team>" stops showing this long after joining. */
const TEAM_JOINED_WINDOW_DAYS = 14;

/** Followed-brand activity looks back this far. */
const FOLLOW_ACTIVITY_WINDOW_DAYS = 7;

/** PostgREST `.in()` builds a URL — keep the id list bounded. */
const MAX_FOLLOWED_IDS = 200;

/**
 * The free-tier base card: progress toward the save cap, escalating as
 * the user approaches it. Pure so the threshold copy is unit-testable.
 */
export function saveUsageNotice(count: number, limit: number): SidebarNotice {
  const remaining = Math.max(0, limit - count);
  let title: string;
  let detail: string;
  if (remaining === 0) {
    title = `You've used all ${limit} free saves`;
    detail = "Upgrade for unlimited saving";
  } else if (remaining <= SAVE_CAP_WARNING_WINDOW) {
    title = `Only ${remaining} free ${remaining === 1 ? "save" : "saves"} left`;
    detail = "Upgrade for unlimited saving";
  } else {
    title = `${count} of ${limit} free saves used`;
    detail = "Upgrade for unlimited use";
  }
  return {
    id: "save-usage",
    kind: "save-usage",
    title,
    detail,
    cta: { label: "Upgrade", href: "/pricing" },
    dismissible: false,
    progress: { count: Math.min(count, limit), limit }
  };
}

/**
 * Stable id for the follow-activity notice. Includes the day of the
 * newest matching email so a dismissal holds until newer mail arrives,
 * at which point the id changes and the card resurfaces.
 */
export function followActivityNoticeId(latestReceivedAt: string): string {
  return `follow-activity:${latestReceivedAt.slice(0, 10)}`;
}

/**
 * Normalized host of a brand-request website ("https://www.nike.com/x"
 * → "nike.com") for matching against `companies.domain`. Returns `null`
 * for unparseable input.
 */
export function websiteHost(website: string): string | null {
  const raw = website.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Builds the prioritized notice list for the signed-in viewer. Always
 * uses the service-role client: several sources (teams, brand requests,
 * free saves) are RLS-locked to service_role, and the viewer is already
 * authenticated by the caller. Each source is independently fault-
 * tolerant — a failing query drops that notice, never the whole list.
 */
export async function listSidebarNotices(
  admin: PirolSupabaseClient,
  viewer: Viewer,
  now: Date = new Date()
): Promise<SidebarNotice[]> {
  const [brandRequest, teamJoined, followActivity, saveUsage] =
    await Promise.all([
      brandRequestNotices(admin, viewer.userId, now).catch((err) => {
        console.error("Failed to load brand-request notices", err);
        return [];
      }),
      teamJoinedNotice(admin, viewer.userId, now).catch((err) => {
        console.error("Failed to load team-joined notice", err);
        return [];
      }),
      followActivityNotice(admin, viewer.userId, now).catch((err) => {
        console.error("Failed to load follow-activity notice", err);
        return [];
      }),
      viewer.hasAccess
        ? Promise.resolve([])
        : countSavedEmails(admin, viewer.userId)
            .then((count) => [saveUsageNotice(count, FREE_SAVE_LIMIT)])
            .catch((err) => {
              console.error("Failed to load save usage", err);
              return [];
            })
    ]);

  // At the cap, the save card is the most urgent thing in the slot;
  // otherwise activity news outranks the always-there usage meter.
  const usage = saveUsage[0];
  const atCap = usage?.progress && usage.progress.count >= usage.progress.limit;
  return atCap
    ? [...saveUsage, ...brandRequest, ...teamJoined, ...followActivity]
    : [...brandRequest, ...teamJoined, ...followActivity, ...saveUsage];
}

/**
 * "<Brand> is now in the archive" for the user's fulfilled requests.
 * "Handled" also covers operator-dismissed requests, so a notice only
 * fires when a live company matches the requested domain (or, failing
 * that, the requested name).
 */
async function brandRequestNotices(
  admin: PirolSupabaseClient,
  userId: string,
  now: Date
): Promise<SidebarNotice[]> {
  const requests = await listHandledBrandRequestsForUser(admin, userId);
  const cutoff = daysAgo(BRAND_REQUEST_WINDOW_DAYS, now);
  const recent = requests.filter(
    (request) =>
      request.handledAt && new Date(request.handledAt).getTime() >= cutoff.getTime()
  );
  if (recent.length === 0) return [];

  const hosts = recent
    .map((request) => websiteHost(request.website))
    .filter((host): host is string => Boolean(host));

  const { data: companies, error } = await admin
    .from("companies")
    .select("id, name, domain, deleted_at")
    .in("domain", hosts.length > 0 ? hosts : ["-"]);
  if (error) throw error;

  const byDomain = new Map(
    (companies ?? [])
      .filter((company) => !company.deleted_at && company.domain)
      .map((company) => [company.domain as string, company])
  );

  const notices: SidebarNotice[] = [];
  for (const request of recent) {
    const host = websiteHost(request.website);
    const company = host ? byDomain.get(host) : undefined;
    if (!company) continue;
    notices.push({
      id: `brand-request:${request.id}`,
      kind: "brand-request",
      title: `${company.name} is now in the archive`,
      detail: "The brand you requested was added.",
      cta: { label: "View brand", href: `/brands/${company.id}` },
      dismissible: true
    });
  }
  return notices;
}

/**
 * "You've joined <team>" shortly after an invite lands the user on a
 * team. Owners created the team themselves, so only plain members get
 * the card.
 */
async function teamJoinedNotice(
  admin: PirolSupabaseClient,
  userId: string,
  now: Date
): Promise<SidebarNotice[]> {
  const team = await getTeamForUser(admin, userId);
  if (!team || team.viewerRole !== "member") return [];

  const self = team.members.find((member) => member.userId === userId);
  if (!self) return [];

  const cutoff = daysAgo(TEAM_JOINED_WINDOW_DAYS, now);
  if (new Date(self.joinedAt).getTime() < cutoff.getTime()) return [];

  return [
    {
      id: `team-joined:${team.id}`,
      kind: "team-joined",
      title: `You've joined ${team.name}`,
      detail: "Manage your team in Settings.",
      cta: { label: "Open settings", href: "/settings" },
      dismissible: true
    }
  ];
}

/**
 * "N new emails from brands you follow" over the past week. The notice
 * id carries the newest email's date, so a dismissal lasts exactly
 * until fresher mail shows up.
 */
async function followActivityNotice(
  admin: PirolSupabaseClient,
  userId: string,
  now: Date
): Promise<SidebarNotice[]> {
  const followedIds = await listFollowedBrandIds(admin, userId);
  if (followedIds.size === 0) return [];

  const since = daysAgo(FOLLOW_ACTIVITY_WINDOW_DAYS, now).toISOString();
  const { data, count, error } = await admin
    .from("captured_emails")
    .select("received_at", { count: "exact" })
    .in("company_id", Array.from(followedIds).slice(0, MAX_FOLLOWED_IDS))
    .is("duplicate_of", null)
    .gt("received_at", since)
    .order("received_at", { ascending: false })
    .limit(1);
  if (error) throw error;

  const latest = data?.[0]?.received_at;
  const total = count ?? 0;
  if (!latest || total === 0) return [];

  return [
    {
      id: followActivityNoticeId(latest),
      kind: "follow-activity",
      title: `${total} new ${total === 1 ? "email" : "emails"} from brands you follow`,
      detail: "From the last 7 days.",
      cta: { label: "See what's new", href: "/following" },
      dismissible: true
    }
  ];
}
