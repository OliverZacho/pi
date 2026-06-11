-- Cached LLM event detection for collections.
--
-- When a collection looks like it revolves around a real-world event
-- (many emails, several brands, clustered in time, event-ish categories)
-- we ask the model to identify the event and label each email with a
-- campaign phase. The result is cached here so the detail page never
-- re-pays the LLM call on every view. Shape (version 1):
--
--   {
--     "version": 1,
--     "status": "detected" | "no_event",
--     "detectedAt": "<ISO timestamp>",
--     "emailCountAtDetection": 43,
--     "model": "claude-haiku-4-5",
--     "confirmed": null | true | false,   -- null = banner pending
--     "event": { name, startDate, endDate, location, kind, confidence, userMessage } | null,
--     "phases": { "<email uuid>": "save_the_date" | ... },
--     "offTopicEmailIds": ["<email uuid>", ...]
--   }
alter table public.collections
  add column if not exists event_detection jsonb;

comment on column public.collections.event_detection is
  'Cached LLM event detection (see lib/collection-event.ts). Null until the collection first qualifies for detection.';

-- Let the usage ledger accept the new feature tag.
alter table public.anthropic_usage
  drop constraint if exists anthropic_usage_feature_check;
alter table public.anthropic_usage
  add constraint anthropic_usage_feature_check
  check (feature in ('classify', 'suggest', 'hq_lookup', 'vision', 'collection_event'));
