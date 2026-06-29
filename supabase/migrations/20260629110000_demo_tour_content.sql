-- ============================================================
-- Onboarding tour demo content.
--
-- One collection + one comparison with FIXED UUIDs that the detail pages
-- whitelist (see lib/demo.ts): /collections/[id] and /compare/[id] render their
-- REAL views to unpaid users for just these two ids, so the tour can show the
-- actual paid features instead of a locked upsell. Owned by the app owner.
--
-- Idempotent (on conflict do nothing) so it's safe to re-run. References live
-- captured_email / company ids — this is prod-only seed data.
-- ============================================================

-- Demo collection — a curated set of captured sends.
insert into public.collections (id, user_id, name, share_slug, icon)
values (
  '00000000-dec0-4011-8000-000000000001',
  'ee79b91b-0ad7-4535-96e6-29f2cf543d25',
  'Editor''s picks',
  'pirol-demo-collection',
  '✨'
)
on conflict (id) do nothing;

insert into public.collection_emails (collection_id, email_id)
values
  ('00000000-dec0-4011-8000-000000000001', '1eae55f1-d0aa-4ac7-bc43-c1c79ab26566'),
  ('00000000-dec0-4011-8000-000000000001', '51ef9deb-3753-43d2-a6e9-37fc5ab31e77'),
  ('00000000-dec0-4011-8000-000000000001', 'd55d76b5-63ad-4ab2-9c86-09e703acb6b8'),
  ('00000000-dec0-4011-8000-000000000001', '273400c3-4ea2-44eb-8ff5-3a0fccd3fd0f'),
  ('00000000-dec0-4011-8000-000000000001', 'aa79597c-a082-4b0a-b8ae-ccb59a534ebe'),
  ('00000000-dec0-4011-8000-000000000001', '620c80f7-d758-4598-a0fb-7c72cf171d7f'),
  ('00000000-dec0-4011-8000-000000000001', 'c84ef472-a788-4ae4-9b02-6e9bee79a8f8'),
  ('00000000-dec0-4011-8000-000000000001', '0ff29ed4-7132-4aa3-82e0-48293cbf27ab'),
  ('00000000-dec0-4011-8000-000000000001', 'c914d15f-9502-41df-899f-af4ff7a1d613')
on conflict do nothing;

-- Demo comparison — ARKET vs COS vs Søstrene Grene.
insert into public.competitor_sets (id, user_id, name)
values (
  '00000000-dec0-4c12-8000-000000000002',
  'ee79b91b-0ad7-4535-96e6-29f2cf543d25',
  'Scandi retail showdown'
)
on conflict (id) do nothing;

insert into public.competitor_set_members (set_id, company_id)
values
  ('00000000-dec0-4c12-8000-000000000002', '3a031ac3-688c-4df0-9d39-1b6c1388a1fd'),
  ('00000000-dec0-4c12-8000-000000000002', 'c5a7d80d-c9d2-4710-b14e-498382bb06d0'),
  ('00000000-dec0-4c12-8000-000000000002', 'e4f386d3-9cab-4beb-adde-b31b7bb80400')
on conflict do nothing;
