import {
  differenceInCalendarDays,
  formatDayKey,
  getActiveTimeZone,
  type TimeZone
} from "./datetime";

/**
 * Offer episodes — grouping a brand's discount emails into the *offers*
 * behind them, so the dashboard can draw stated validity windows and call
 * out deadline behaviour (kept vs quietly extended).
 *
 * The honesty rule that shapes everything here: we only ever claim a
 * window the emails themselves stated. An email with no `offerEndsOn`
 * contributes a point-in-time send and nothing more; a gap in sends is
 * never treated as evidence that an offer ended.
 *
 * Pure and side-effect free on purpose: the same function runs server-side
 * (promo deadline stats in brand-db) and client-side (the discount
 * timeline), so both always agree on what an "offer" is.
 */

export type OfferEmail = {
  id: string;
  /** ISO timestamp of the send. */
  receivedAt: string;
  /** Discount depth in percent; emails with no positive depth are ignored. */
  discountPercent: number | null;
  promoCode: string | null;
  /** `YYYY-MM-DD` stated last-valid day, from the classifier. */
  offerEndsOn: string | null;
  /** True when the copy explicitly announced a deadline extension. */
  offerIsExtension: boolean | null;
};

export type OfferEpisodeEmail = {
  id: string;
  receivedAt: string;
  depth: number;
  /** Day key of the send in the platform zone, kept for day-level math. */
  sendDay: string;
  offerEndsOn: string | null;
  isExtension: boolean;
};

export type OfferEpisode = {
  /** Discount depth of the offer (deepest send wins if reminders disagree). */
  depth: number;
  /** Chronological sends belonging to this offer. */
  emails: OfferEpisodeEmail[];
  firstSendAt: string;
  lastSendAt: string;
  /**
   * The offer's ORIGINAL stated deadline (`YYYY-MM-DD`) — the first end date
   * any of its emails stated. Later, larger end dates count as extensions and
   * never overwrite this. Null when no email stated a deadline.
   */
  statedEndOn: string | null;
  /**
   * Latest day the offer is known to have been valid once extended: the
   * largest later stated end date, or the day of a send that arrived after
   * {@link statedEndOn}. Null when the offer was never extended.
   */
  extendedUntilOn: string | null;
  /** True when the brand extended the offer past its original deadline. */
  extended: boolean;
  /** Calendar days between the original deadline and {@link extendedUntilOn}. */
  extensionDays: number;
  promoCode: string | null;
};

export type OfferDeadlineSummary = {
  /** Offers whose emails stated an explicit deadline. */
  withDeadline: number;
  /** Offers whose stated deadline has passed without any extension signal. */
  endedOnTime: number;
  /** Offers extended past their original stated deadline. */
  extended: number;
};

/** Reminder emails for the same codeless offer arrive within a few days. */
const MAX_REMINDER_GAP_DAYS = 4;
/**
 * A send this many days past the offer's known end still joins the episode
 * (and marks it extended) rather than starting a new one — "last chance"
 * blasts routinely land the morning after a midnight deadline.
 */
const DEADLINE_GRACE_DAYS = 2;
/**
 * An email that explicitly says "extended" reattaches to a same-depth offer
 * across a longer quiet stretch than an ordinary reminder would.
 */
const MAX_EXTENSION_GAP_DAYS = 10;
/**
 * The same promo code seen again after this long is treated as a code reuse
 * (evergreen codes like WELCOME10) and starts a fresh episode.
 */
const MAX_CODE_GAP_DAYS = 45;

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeCode(code: string | null): string | null {
  if (!code) return null;
  const trimmed = code.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

function maxDayKey(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  // Day keys are zero-padded ISO dates, so lexicographic order is date order.
  return a >= b ? a : b;
}

function dayDiff(fromDay: string, toDay: string, zone: TimeZone): number {
  // Midday anchors keep the diff stable across DST edges.
  return differenceInCalendarDays(`${fromDay}T12:00:00Z`, `${toDay}T12:00:00Z`, zone);
}

/** The latest day an episode is known to be valid, for window matching. */
function knownEndOn(episode: OfferEpisode): string | null {
  return maxDayKey(episode.statedEndOn, episode.extendedUntilOn);
}

/**
 * Groups a brand's discount emails (any order) into chronological offer
 * episodes. Linking is conservative:
 *
 *  1. a shared promo code binds sends into one episode (unless the code
 *     resurfaces after {@link MAX_CODE_GAP_DAYS} — that's an evergreen code,
 *     not one long sale), and
 *  2. codeless sends join a same-depth episode only while it is plausibly
 *     still running: inside its stated window (+ grace), within a reminder
 *     gap of its last send, or within a longer gap when the email itself
 *     says the offer was extended.
 *
 * Everything that doesn't confidently link starts its own episode, so an
 * over-split (two bars where one sale ran) is the failure mode — never an
 * invented multi-week window.
 */
export function buildOfferEpisodes(
  emails: OfferEmail[],
  zone: TimeZone = getActiveTimeZone()
): OfferEpisode[] {
  const sends: OfferEpisodeEmail[] = [];
  const codes = new Map<string, string | null>();

  for (const email of emails) {
    const depth =
      email.discountPercent === null ? NaN : Number(email.discountPercent);
    if (!Number.isFinite(depth) || depth <= 0) continue;
    const t = new Date(email.receivedAt).getTime();
    if (!Number.isFinite(t)) continue;
    const endsOn =
      email.offerEndsOn && DAY_KEY_RE.test(email.offerEndsOn.trim())
        ? email.offerEndsOn.trim()
        : null;
    sends.push({
      id: email.id,
      receivedAt: email.receivedAt,
      depth,
      sendDay: formatDayKey(t, zone),
      offerEndsOn: endsOn,
      isExtension: email.offerIsExtension === true
    });
    codes.set(email.id, normalizeCode(email.promoCode));
  }

  sends.sort(
    (a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime()
  );

  const episodes: OfferEpisode[] = [];

  for (const send of sends) {
    const code = codes.get(send.id) ?? null;
    let target: OfferEpisode | null = null;

    // Newest episodes first: a reminder always belongs to the most recent
    // plausible offer, not an older one that happens to share its depth.
    for (let i = episodes.length - 1; i >= 0 && !target; i--) {
      const episode = episodes[i];
      const gap = dayDiff(
        formatDayKey(episode.lastSendAt, zone),
        send.sendDay,
        zone
      );

      if (code && episode.promoCode === code) {
        if (gap <= MAX_CODE_GAP_DAYS) target = episode;
        continue;
      }
      // A coded send never joins a differently-coded episode.
      if (code && episode.promoCode && episode.promoCode !== code) continue;

      if (episode.depth !== send.depth) continue;

      const end = knownEndOn(episode);
      const insideWindow =
        end !== null && dayDiff(send.sendDay, end, zone) >= -DEADLINE_GRACE_DAYS;
      const reminderGap = gap <= MAX_REMINDER_GAP_DAYS;
      const extensionGap = send.isExtension && gap <= MAX_EXTENSION_GAP_DAYS;

      if (insideWindow || reminderGap || extensionGap) target = episode;
    }

    if (!target) {
      target = {
        depth: send.depth,
        emails: [],
        firstSendAt: send.receivedAt,
        lastSendAt: send.receivedAt,
        statedEndOn: null,
        extendedUntilOn: null,
        extended: false,
        extensionDays: 0,
        promoCode: null,
      };
      episodes.push(target);
    }

    target.emails.push(send);
    target.lastSendAt = send.receivedAt;
    target.depth = Math.max(target.depth, send.depth);
    if (code && !target.promoCode) target.promoCode = code;

    // Deadline bookkeeping. The FIRST stated end is the original promise;
    // anything later or larger is extension evidence.
    if (send.offerEndsOn) {
      if (!target.statedEndOn) {
        target.statedEndOn = send.offerEndsOn;
      } else if (send.offerEndsOn > target.statedEndOn) {
        target.extended = true;
        target.extendedUntilOn = maxDayKey(target.extendedUntilOn, send.offerEndsOn);
      }
    }
    if (send.isExtension) {
      target.extended = true;
      target.extendedUntilOn = maxDayKey(
        target.extendedUntilOn,
        send.offerEndsOn ?? send.sendDay
      );
    }
    if (target.statedEndOn && send.sendDay > target.statedEndOn) {
      // The offer demonstrably outlived its deadline: a same-offer send
      // arrived after the stated end (grace only affects LINKING, not the
      // extended verdict — a "last chance" send one day late is still late).
      target.extended = true;
      target.extendedUntilOn = maxDayKey(target.extendedUntilOn, send.sendDay);
    }
  }

  for (const episode of episodes) {
    if (episode.extended && episode.statedEndOn && episode.extendedUntilOn) {
      episode.extensionDays = Math.max(
        0,
        dayDiff(episode.statedEndOn, episode.extendedUntilOn, zone)
      );
    }
  }

  return episodes;
}

/**
 * Deadline-behaviour rollup for the promo card tiles. `today` is a day key
 * (platform zone) so a still-running offer is neither "ended on time" nor
 * late — it just isn't judged yet.
 */
export function summarizeOfferDeadlines(
  episodes: OfferEpisode[],
  today: string
): OfferDeadlineSummary {
  let withDeadline = 0;
  let endedOnTime = 0;
  let extended = 0;

  for (const episode of episodes) {
    if (episode.statedEndOn) withDeadline += 1;
    if (episode.extended) {
      extended += 1;
    } else if (episode.statedEndOn && episode.statedEndOn < today) {
      endedOnTime += 1;
    }
  }

  return { withDeadline, endedOnTime, extended };
}
