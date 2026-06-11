import { recordAnthropicUsage } from "./anthropic-usage";
import {
  CAMPAIGN_PHASES,
  COLLECTION_EVENT_KINDS,
  type CampaignPhase,
  type CollectionEventDetection,
  type CollectionEventKind
} from "./collection-event-shared";

/**
 * Server-side collection event detection.
 *
 * One tool-use call (same pattern as `lib/classify.ts`) that answers two
 * questions about a collection at once:
 *
 *  1. Does this collection revolve around a single real-world event?
 *     If so: name, dates (preferring dates stated in the emails over the
 *     model's prior knowledge, so unknown events work too), location, kind.
 *  2. Which campaign phase is each email — save-the-date, programme
 *     reveal, reminder, doors-open, wrap-up?
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
      "Decide whether the collection revolves around ONE specific real-world occasion — a trade fair, festival, conference, sports event, sale period (e.g. Black Friday), or product drop. " +
      "A collection qualifies only when a clear majority of emails reference the same occasion; a loose theme (e.g. 'lighting brands') is NOT an event. " +
      "Event dates: prefer dates stated in the emails themselves (subjects/preheaders like '10–12 June') over prior knowledge, and resolve them to the year the emails were sent. Use null when the emails don't reveal a date and you are not confident. " +
      "user_message: one friendly sentence for the collection owner, e.g. \"It looks like you're collecting emails about 3daysofdesign, a design festival happening June 10–12, 2026 in Copenhagen.\" " +
      "Campaign phases — label EVERY email with the phase it plays in the run-up to the event: " +
      "save_the_date: first announcements and early invitations, typically weeks ahead ('you're invited', 'save the date', 'join us at …'). " +
      "programme: agenda/programme/line-up reveals and content details ('full program unveiled', 'designtalks', 'what to expect', exhibition previews announced ahead of the event). " +
      "reminder: short-notice nudges in the final days before it starts ('see you tomorrow', 'book your spot', 'don't miss', 'ses vi?'). " +
      "day_of: sent while the event is running ('now open', 'the exhibition is open', 'we're open', 'visit us today'). " +
      "wrap_up: post-event thanks, recaps, highlights. " +
      "other: emails in the collection that don't play a run-up role (including off-topic ones). " +
      "off_topic_email_numbers: the numbers of emails that do NOT appear related to the detected event at all. " +
      "If no single event emerges, return is_event_collection=false with event fields null, every phase 'other', and an empty off-topic list.",
    tools: [
      {
        name: "detect_collection_event",
        description:
          "Report whether this email collection centers on a real-world event, identify it, and label each email's campaign phase.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            is_event_collection: { type: "boolean" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            event_name: { type: ["string", "null"], maxLength: 120 },
            event_start_date: {
              type: ["string", "null"],
              description: "ISO date (YYYY-MM-DD) in the emails' year"
            },
            event_end_date: { type: ["string", "null"] },
            location: { type: ["string", "null"], maxLength: 120 },
            event_kind: {
              type: "string",
              enum: [...COLLECTION_EVENT_KINDS, "none"]
            },
            user_message: { type: "string", maxLength: 300 },
            off_topic_email_numbers: {
              type: "array",
              items: { type: "integer" }
            },
            phases: {
              type: "array",
              description: "One entry per email, in order.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  email_number: { type: "integer" },
                  phase: { type: "string", enum: [...CAMPAIGN_PHASES] }
                },
                required: ["email_number", "phase"]
              }
            }
          },
          required: [
            "is_event_collection",
            "confidence",
            "event_name",
            "event_start_date",
            "event_end_date",
            "location",
            "event_kind",
            "user_message",
            "off_topic_email_numbers",
            "phases"
          ]
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

function buildDetection(
  raw: Record<string, unknown>,
  ordered: EventDetectionEmail[]
): CollectionEventDetection {
  const isEvent = raw.is_event_collection === true;
  const name = typeof raw.event_name === "string" ? raw.event_name.trim() : "";

  const phases: Record<string, CampaignPhase> = {};
  if (Array.isArray(raw.phases)) {
    for (const entry of raw.phases) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const email = emailByNumber(ordered, item.email_number);
      const phase = item.phase;
      if (email && typeof phase === "string" && PHASE_LOOKUP.has(phase)) {
        phases[email.id] = phase as CampaignPhase;
      }
    }
  }

  const offTopicEmailIds: string[] = [];
  if (Array.isArray(raw.off_topic_email_numbers)) {
    for (const value of raw.off_topic_email_numbers) {
      const email = emailByNumber(ordered, value);
      if (email) offTopicEmailIds.push(email.id);
    }
  }

  const detected = isEvent && name.length > 0;

  return {
    version: 1,
    status: detected ? "detected" : "no_event",
    detectedAt: new Date().toISOString(),
    emailCountAtDetection: ordered.length,
    model: getModel(),
    confirmed: null,
    event: detected
      ? {
          name,
          startDate: normalizeIsoDate(raw.event_start_date),
          endDate: normalizeIsoDate(raw.event_end_date),
          location:
            typeof raw.location === "string" && raw.location.trim().length > 0
              ? raw.location.trim()
              : null,
          kind: KIND_LOOKUP.has(String(raw.event_kind))
            ? (raw.event_kind as CollectionEventKind)
            : "other",
          confidence:
            typeof raw.confidence === "number"
              ? Math.max(0, Math.min(1, raw.confidence))
              : 0,
          userMessage:
            typeof raw.user_message === "string" && raw.user_message.trim().length > 0
              ? raw.user_message.trim()
              : `It looks like this collection is about ${name}.`
        }
      : null,
    phases,
    offTopicEmailIds
  };
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
