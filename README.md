# New City Tool Swap

Tool-lending site for the New City men's group, on Cloudflare Pages. A copy of Mayfair Tool Swap without the Chief Moocher standings.

- `index.html`, `style.css`, `app.js`: the front end (no build step).
- `_worker.js`: the backend (Pages advanced mode). Serves `/api/*`, everything else comes from the static files.
- `wrangler.toml`: Pages config, including the D1 binding `DB` → `newcitytoolswap-db`.
- `schema.sql`: the database layout (already applied to `newcitytoolswap-db`).

Needs the Pages secrets `POLICY_AUD` and `TEAM_DOMAIN` (Cloudflare Access).

## Publishing

Every push publishes automatically through GitHub Actions (`.github/workflows/deploy.yml`) to the Pages project `newcitytoolswap` (created on the first run if missing):

- push to `main`: the live site, newcitytoolswap.pages.dev
- push to any other branch, e.g. `test`: a test copy at `test.newcitytoolswap.pages.dev`

Requires the repository secret `CLOUDFLARE_API_TOKEN` (a Cloudflare API token with Account > Cloudflare Pages > Edit and Account > D1 > Edit).
