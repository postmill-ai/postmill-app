-- Legacy seeding stored media-domain defaults with model NULL for
-- model-bearing providers (e.g. openai video-caption / image-focal-point,
-- whose categories have no model catalog). Such a row can never resolve —
-- the stored-model catalog check fails on every read and warns forever —
-- and the seed now refuses to write them. Delete the stranded rows; the
-- resolver falls back to a live auto-pick for these orgs. Action providers
-- are model-less by design, but their seeded rows carry model NULL too and
-- re-seed identically on next boot, so the delete is safe either way.
-- Data-only, idempotent, expand-contract safe (no schema change).
DELETE FROM "OrgDefaultModel"
WHERE "domain" = 'media' AND "model" IS NULL;
