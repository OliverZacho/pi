-- Pirol — Collection rules (auto-populate collections from an inbox query).
--
-- A "rule-based" collection is one whose membership is derived from a
-- saved query over `captured_emails` instead of being manually curated.
-- The rule shape is intentionally simple: a `combinator` (AND/OR) plus a
-- flat list of `conditions`, each one of:
--
--   • { field: "search",           operator: "contains", value: string  }
--   • { field: "category",         operator: "is",       value: string  } (EmailCategory)
--   • { field: "brand",            operator: "is",       value: uuid    } (companies.id)
--   • { field: "market",           operator: "is",       value: string  } (companies.market)
--   • { field: "discount_percent", operator: "gte"|"lte"|"eq", value: number }
--
-- The column is stored as `jsonb` so we can iterate on the schema without
-- another migration. Application code is the source of truth for the
-- structure (see `lib/collections-db.ts`). A non-null `rules` flips the
-- collection into "rule-based" mode: the per-row `collection_emails`
-- membership is ignored and the visible emails are computed from the
-- rule at read time.
--
-- Empty collections (no rules + no members) and manually-curated ones
-- continue to work exactly as before — this column is purely additive.

alter table public.collections
  add column if not exists rules jsonb;

-- Defensive shape check so the column can only ever hold an object (or
-- null). Field-level validation lives in the application layer where it
-- can return useful error messages, but rejecting completely malformed
-- payloads at the DB level keeps the data tidy and removes a class of
-- "what is `rules: 42`?" bugs.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'collections_rules_is_object'
  ) then
    alter table public.collections
      add constraint collections_rules_is_object
      check (rules is null or jsonb_typeof(rules) = 'object');
  end if;
end$$;
