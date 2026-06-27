import { recordAnthropicUsage } from "./anthropic-usage";
import {
  CAMPAIGN_PHASES,
  COLLECTION_EVENT_KINDS,
  type CampaignPhase,
  type CollectionDetectedEvent,
  type CollectionEventDetection,
  type CollectionEventKind,
  type CollectionEventWithEmails
} from "./collection-event-shared";

/**
 * Server-side collection event detection.
 *
 * One tool-use call (same pattern as `lib/classify.ts`) that answers two
 * questions about a collection at once:
 *
 *  1. Which real-world events does this collection cover? Usually one
 *     (a trade fair, a festival, Black Friday…), but a collection can mix
 *     two or more occasions — each comes back with its name, dates
 *     (preferring dates stated in the emails over the model's prior
 *     knowledge, so unknown events work too), location and kind.
 *  2. Which event does each email belong to, and which campaign phase does
 *     it play — save-the-date, programme reveal, reminder, doors-open,
 *     wrap-up? Emails about none of the events are left unassigned so they
 *     never pollute another event's figures.
 *
 * Inputs are only metadata the collection page already loads (subject,
 * preheader, brand, date, category) — no bodies — so even a 200-email
 * collection stays around ~10k input tokens on Haiku.
 */

const DEFAULT_MODEL = "claude-haiku-4-5";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Longer than classify's 15s: the phases array scales with collection
// size, so big collections legitimately produce a few thousand output
// tokens.
const LLM_TIMEOUT_MS = 30_000;
const MAX_EMAILS = 200;
const SUBJECT_LIMIT = 160;
const PREHEADER_LIMIT = 120;
// A collection rarely centres on more than a couple of occasions; cap the
// list so a genuinely messy collection doesn't sprout a tab per brand.
const MAX_EVENTS = 4;

function getModel(): string {
  return (
    process.env.PIROL_COLLECTION_EVENT_MODEL ??
    process.env.ANTHROPIC_MODEL ??
    DEFAULT_MODEL
  );
}

export type EventDetectionEmail = {
  id: string;
  subject: string;
  preheader: string | null;
  receivedAt: string;
  category: string;
  companyName: string;
};

export class CollectionEventDetectionError extends Error {}

export async function detectCollectionEvent(
  collectionName: string,
  emails: EventDetectionEmail[]
): Promise<CollectionEventDetection> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new CollectionEventDetectionError("ANTHROPIC_API_KEY not configured");
  }

  // Chronological order makes the campaign arc (announce → remind →
  // open) legible to the model, and the 1-based numbering below is what
  // it references in `phases` / `off_topic_email_numbers`.
  const ordered = [...emails]
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    .slice(0, MAX_EMAILS);

  const lines = ordered
    .map((email, index) => {
      const date = email.receivedAt.slice(0, 10);
      const subject = truncate(email.subject || "(no subject)", SUBJECT_LIMIT);
      const preheader = email.preheader
        ? ` / ${truncate(email.preheader, PREHEADER_LIMIT)}`
        : "";
      return `${index + 1}. [${date}] (${email.category}) ${email.companyName} — "${subject}"${preheader}`;
    })
    .join("\n");

  const today = new Date().toISOString().slice(0, 10);

  const body = {
    model: getModel(),
    max_tokens: 4096,
    temperature: 0,
    system:
      "You analyze a user's collection of marketing emails from an email-marketing archive. " +
      "You must always call the detect_collection_event tool exactly once; never reply with prose. " +
      "Identify each distinct real-world occasion the collection covers — a trade fair, festival, conference, sports event, sale period (e.g. Black Friday), or product drop. " +
      "Most collections centre on ONE occasion, but some mix two or more (e.g. emails about both 3daysofdesign AND Father's Day). List every occasion that a meaningful cluster of emails references, most prevalent first, up to " +
      `${MAX_EVENTS}. ` +
      "An occasion qualifies only when several emails reference it; a loose theme (e.g. 'lighting brands') is NOT an event, and a single stray email is not its own event. " +
      "Assign EVERY email to exactly one event via event_index (0-based into the events array you return), or -1 when the email is not about any listed event — never force an unrelated email onto an event. " +
      "Event dates: prefer dates stated in the emails themselves (subjects/preheaders like '10–12 June') over prior knowledge, and resolve them to the year the emails were sent. Use null when the emails don't reveal a date and you are not confident. " +
      "user_message (per event): one friendly sentence for the collection owner, e.g. \"It looks like you're collecting emails about 3daysofdesign, a design festival happening June 10–12, 2026 in Copenhagen.\" " +
      "Campaign phases — label EVERY email with the phase it plays in the campaign arc around ITS event, which runs before, during AND after it: " +
      "save_the_date: announcements and invitations whose point is 'this is happening, mark your calendar' ('you're invited', 'save the date', 'join us at …'). Often weeks ahead, but an explicit save-the-date/invitation subject belongs here no matter how late it was sent. " +
      "programme: agenda/programme/line-up reveals and content details ('full program unveiled', 'designtalks', 'what to expect', exhibition previews announced ahead of the event). " +
      "reminder: short-notice nudges in the final days before it starts ('see you tomorrow', 'book your spot', 'don't miss', 'ses vi?'). " +
      "day_of: sent while the event is running ('now open', 'the exhibition is open', 'we're open', 'visit us today'). " +
      "wrap_up: anything sent AFTER the event ends that looks back on it — thank-yous ('thanks for visiting', 'thanks for joining us'), recaps, highlights, photo/press roundups, 'see you next year', replays and on-demand recordings, post-show follow-ups. Many brands send these, so expect a wrap_up tail: an email dated after the event that refers back to it belongs here, NOT in other. " +
      "other: emails in the collection that don't play a before/during/after role at all. Use it sparingly — you only see subjects and preheaders, so an email that doesn't mention the event may still be about it (e.g. a product announcement timed to the event, or a post-event recap); give such emails the phase their timing and content suggest, and prefer wrap_up over other for anything sent after the event. " +
      "IMPORTANT: when a subject explicitly names its phase ('save the date' → save_the_date, 'programme'/'agenda' → programme, 'now open'/'we're open' → day_of), that wording wins over send timing. " +
      "If no event emerges, return is_event_collection=false with an empty events array and every email's event_index -1 and phase 'other'.",
    tools: [
      {
        name: "detect_collection_event",
        description:
          "Report which real-world events this email collection centers on, identify each, and assign + phase-label every email.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            is_event_collection: { type: "boolean" },
            events: {
              type: "array",
              description:
                "Each distinct event the collection covers, most prevalent first. Empty when is_event_collection is false.",
              maxItems: MAX_EVENTS,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string", maxLength: 120 },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  start_date: {
                    type: ["string", "null"],
                    description: "ISO date (YYYY-MM-DD) in the emails' year"
                  },
                  end_date: { type: ["string", "null"] },
                  location: { type: ["string", "null"], maxLength: 120 },
                  kind: {
                    type: "string",
                    enum: [...COLLECTION_EVENT_KINDS, "none"]
                  },
                  user_message: { type: "string", maxLength: 300 }
                },
                required: [
                  "name",
                  "confidence",
                  "start_date",
                  "end_date",
                  "location",
                  "kind",
                  "user_message"
                ]
              }
            },
            emails: {
              type: "array",
              description: "One entry per email, in order.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  email_number: { type: "integer" },
                  event_index: {
                    type: "integer",
                    description:
                      "0-based index into events, or -1 when the email is about none of them."
                  },
                  phase: { type: "string", enum: [...CAMPAIGN_PHASES] }
                },
                required: ["email_number", "event_index", "phase"]
              }
            }
          },
          required: ["is_event_collection", "events", "emails"]
        }
      }
    ],
    tool_choice: { type: "tool", name: "detect_collection_event" },
    messages: [
      {
        role: "user",
        content:
          `Today is ${today}.\n\n` +
          `Collection name: "${collectionName}"\n` +
          `It contains ${ordered.length} marketing emails. ` +
          `Each line: number. [received date] (category) Brand — "subject" / preheader\n\n` +
          lines
      }
    ]
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    throw new CollectionEventDetectionError(
      error instanceof Error ? error.message : "anthropic request failed"
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new CollectionEventDetectionError(
      `anthropic http ${response.status}: ${errorBody.slice(0, 300)}`
    );
  }

  const json = (await response.json()) as {
    content?: Array<{
      type: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    usage?: unknown;
  };

  void recordAnthropicUsage({
    feature: "collection_event",
    model: getModel(),
    usage: json
  });

  const toolBlock = json.content?.find(
    (block) => block.type === "tool_use" && block.name === "detect_collection_event"
  );
  if (!toolBlock || !toolBlock.input) {
    throw new CollectionEventDetectionError("anthropic returned no tool_use block");
  }

  return buildDetection(toolBlock.input, ordered);
}

// ---------- Response normalisation ----------

const PHASE_LOOKUP = new Set<string>(CAMPAIGN_PHASES);
const KIND_LOOKUP = new Set<string>(COLLECTION_EVENT_KINDS);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalises the model's tool-call payload into the cached detection
 * shape: parses the events, slices the collection per event, and applies
 * the deterministic phase overrides. Exported for tests.
 */
export function buildDetection(
  raw: Record<string, unknown>,
  ordered: EventDetectionEmail[]
): CollectionEventDetection {
  const isEvent = raw.is_event_collection === true;

  // Parse the named events (most prevalent first), keeping only well-formed
  // ones and capping the list.
  const events: CollectionDetectedEvent[] = [];
  if (Array.isArray(raw.events)) {
    for (const entry of raw.events) {
      const parsed = parseRawEvent(entry);
      if (parsed) events.push(parsed);
      if (events.length >= MAX_EVENTS) break;
    }
  }

  // Per-email: which event it belongs to, and its phase. `phases` is the
  // whole-collection map (back-compat / single-event card); the per-event
  // maps below feed the tabbed view so events never blend.
  const phases: Record<string, CampaignPhase> = {};
  const eventIndexById = new Map<string, number>();
  if (Array.isArray(raw.emails)) {
    for (const entry of raw.emails) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const email = emailByNumber(ordered, item.email_number);
      if (!email) continue;
      const phase = item.phase;
      if (typeof phase === "string" && PHASE_LOOKUP.has(phase)) {
        phases[email.id] = phase as CampaignPhase;
      }
      const idx = item.event_index;
      if (typeof idx === "number" && Number.isInteger(idx) && idx >= 0 && idx < events.length) {
        eventIndexById.set(email.id, idx);
      }
    }
  }

  // Deterministic overrides — same philosophy as classifyFromRules: when
  // the subject literally names its phase, that beats the model's timing
  // judgement (which wavers run to run on e.g. a late "SAVE THE DATES").
  for (const email of ordered) {
    const explicit = explicitPhaseFromSubject(email.subject);
    if (explicit) phases[email.id] = explicit;
  }

  // Slice the collection per event, preserving chronological order.
  const eventsWithEmails: CollectionEventWithEmails[] = events.map((event) => ({
    ...event,
    emailIds: [],
    phases: {}
  }));
  for (const email of ordered) {
    const idx = eventIndexById.get(email.id);
    if (idx === undefined) continue;
    const bucket = eventsWithEmails[idx];
    bucket.emailIds.push(email.id);
    bucket.phases[email.id] = phases[email.id] ?? "other";
  }

  // An event the model named but assigned nothing to would render an empty
  // tab — drop it. The collection counts as an event collection only if at
  // least one event actually owns emails.
  const nonEmpty = eventsWithEmails.filter((event) => event.emailIds.length > 0);
  const detected = isEvent && nonEmpty.length > 0;
  const primary = detected ? nonEmpty[0] : null;

  return {
    version: 1,
    status: detected ? "detected" : "no_event",
    detectedAt: new Date().toISOString(),
    emailCountAtDetection: ordered.length,
    model: getModel(),
    confirmed: null,
    event: primary
      ? {
          name: primary.name,
          startDate: primary.startDate,
          endDate: primary.endDate,
          location: primary.location,
          kind: primary.kind,
          confidence: primary.confidence,
          userMessage: primary.userMessage
        }
      : null,
    phases,
    ...(detected ? { events: nonEmpty } : {})
  };
}

/** Normalise one event object from the tool call, or null when unusable. */
function parseRawEvent(raw: unknown): CollectionDetectedEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const name = typeof e.name === "string" ? e.name.trim() : "";
  if (name.length === 0) return null;
  return {
    name,
    startDate: normalizeIsoDate(e.start_date),
    endDate: normalizeIsoDate(e.end_date),
    location:
      typeof e.location === "string" && e.location.trim().length > 0
        ? e.location.trim()
        : null,
    kind: KIND_LOOKUP.has(String(e.kind))
      ? (e.kind as CollectionEventKind)
      : "other",
    confidence:
      typeof e.confidence === "number" ? Math.max(0, Math.min(1, e.confidence)) : 0,
    userMessage:
      typeof e.user_message === "string" && e.user_message.trim().length > 0
        ? e.user_message.trim()
        : `It looks like this collection is about ${name}.`
  };
}

/**
 * Maps unambiguous subject phrasing straight to a phase. Deliberately
 * narrow — only phrases that name the phase outright qualify, anything
 * interpretive stays with the model. Exported for tests.
 */
export function explicitPhaseFromSubject(subject: string): CampaignPhase | null {
  if (/\bsave the dates?\b/i.test(subject)) return "save_the_date";
  if (/\b(?:now open|we'?re open|doors (?:are )?open)\b/i.test(subject)) {
    return "day_of";
  }
  // Unambiguous post-event phrasing. Anchored tightly so run-up nudges
  // ("see you tomorrow", "see you there") never match — only the
  // look-back wording does.
  if (
    /\bsee you next (?:year|time)\b/i.test(subject) ||
    /\bthank(?:s| you)\b[^.!?]*\bfor (?:visiting|joining|coming|stopping by)\b/i.test(
      subject
    )
  ) {
    return "wrap_up";
  }
  return null;
}

function emailByNumber(
  ordered: EventDetectionEmail[],
  value: unknown
): EventDetectionEmail | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return ordered[value - 1] ?? null;
}

function normalizeIsoDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value) ? value : null;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
