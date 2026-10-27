# halo.je Studio

Proposals, drawings, jobs, customers and the price file for halo.je, as an installable web app (iPhone, iPad, Mac).

- `src/studio.html` – the app (screens and logic).
- `docs/` – what gets deployed: `index.html` (built), `backend.js` (Supabase data, files and sign-in), service worker, icons, fonts, vendored libraries.
- `tools/build.py` – builds `docs/index.html` from `src/studio.html`. Run `python3 tools/build.py` after editing.
- `tests/` – headless browser checks run against an in-memory Supabase stand-in.

Backend: Supabase project `halo-studio` (eu-west-2). One `docs` table (collection, id, jsonb data) with row-level security limited to addresses in `members`, realtime enabled, and a private `files` storage bucket.
