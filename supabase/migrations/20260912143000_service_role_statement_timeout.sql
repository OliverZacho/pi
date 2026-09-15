-- ============================================================
-- Give server-side (service_role) requests a 30s statement timeout.
--
-- PostgREST inherits the authenticator's 8s statement_timeout for every
-- role it switches to. That is right for anon (3s) and authenticated (8s)
-- traffic from the browser, but the ingest processor also runs through
-- PostgREST as service_role, and a captured_emails INSERT that carries a
-- large plain_text body into the trigram GIN index can legitimately take
-- more than 8s when two processor runs overlap. Each cancel wasted the
-- work and cost the event one of its three attempts.
--
-- 30s still bounds runaway queries; it only stops the ingest path from
-- being cancelled mid-write. PostgREST picks role settings up on config
-- reload.
-- ============================================================

alter role service_role set statement_timeout = '30s';

notify pgrst, 'reload config';
