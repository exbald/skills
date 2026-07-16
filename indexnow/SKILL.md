---
name: indexnow
description: Set up IndexNow for a website and submit URLs so search engines (Bing, Yandex, Seznam, Naver — not Google) learn about added, updated, or deleted pages within seconds instead of waiting for crawlers. Use when the user wants to "set up IndexNow", "ping search engines", "submit URLs to Bing", "get pages indexed faster", or after shipping/updating public pages on a site that already has IndexNow wired up.
---

# IndexNow

IndexNow is an open protocol: host a key file on your domain to prove ownership, then POST changed URLs to `https://api.indexnow.org/indexnow` — one endpoint that fans out to all participating engines (Bing, Yandex, Seznam, Naver, Amazon, etc.). Google does **not** participate; sitemaps still cover it.

Two jobs this skill covers:

1. **Setup** — wire IndexNow into a project (key file + submit script + CI auto-trigger)
2. **Submission** — send URLs on demand with the bundled script

## Core protocol facts

- **Key**: 8–128 chars of `a-z A-Z 0-9 -`. Convention: 32 hex chars (`openssl rand -hex 16`).
- **Ownership**: host `https://example.com/<key>.txt` containing exactly the key (UTF-8). The key is public by design — committing it to the repo is standard, no secret management.
- **Submit**: `POST https://api.indexnow.org/indexnow` with JSON `{ host, key, keyLocation, urlList }` — up to 10,000 URLs per POST.
- **Responses**: `200` OK; `202` accepted, key validation pending (normal on first-ever submission); `403` bad key; `422` URLs don't belong to host; `429` spam — back off.
- **200/202 means "received", not "indexed".** Verify receipt in Bing Webmaster Tools → IndexNow.
- **Deletions count too**: submit removed URLs so engines recrawl and observe the 404/410.
- **Golden rule: submit on change only.** Never on a schedule, never resubmit unchanged URLs — it risks 429s and dilutes the signal.

## Setup workflow

### 1. Generate and host the key

```bash
openssl rand -hex 16   # e.g. 0edfa8fc528478822b6a064fb5b11607
```

Create `<key>.txt` containing exactly the key, served at the site root:

- **Next.js / most frameworks**: drop it in `public/`
- **Static hosts**: put it in the web root
- Verify after deploy: `curl https://example.com/<key>.txt` must return the key

### 2. Add the submit script

Copy `scripts/indexnow-submit.mjs` from this skill into the project's `scripts/`. It's dependency-free Node (18+). Usage:

```bash
# Explicit URLs
node scripts/indexnow-submit.mjs --site https://www.example.com --urls https://www.example.com/pricing

# Everything in the live sitemap (first-time seeding only)
node scripts/indexnow-submit.mjs --site https://www.example.com --sitemap

# Preview without POSTing
node scripts/indexnow-submit.mjs --site https://www.example.com --sitemap --dry-run
```

The script auto-discovers the key from `public/*.txt` (32-hex basename) or takes `--key`. `--site` can be replaced by a `SITE_URL` env var.

### 3. Automate on content change (the valuable part)

The best trigger is a **diff of the project's sitemap source on merge to main** — submit exactly the URLs that are new, changed, or removed. If the project maintains a sitemap with per-route `lastModified` dates (e.g. a Next.js `sitemap.ts` with a literal routes array), a GitHub Actions workflow like this makes "bump the lastModified date" the single ritual that both keeps the sitemap honest and pings engines:

```yaml
name: IndexNow
on:
  push:
    branches: [main]
    paths: [src/app/sitemap.ts]
  workflow_dispatch:
jobs:
  submit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: node scripts/indexnow-submit.mjs --site https://www.example.com --changed "${{ github.event.before }}"
```

For `--changed` to work, extend the script with a project-specific diff: parse the sitemap source at the old git ref (`git show <ref>:path/to/sitemap.ts`) vs the working tree, and submit routes that are **new, have a bumped lastModified, or were removed**. Adapt the parsing to how the project defines its routes (see the reference implementation notes at the bottom of the script).

Avoid these automation shapes:

- **Cron resubmission of the whole sitemap** — explicitly against protocol guidance
- **Submit-on-every-deploy without diffing** — noisy, spammy, most deploys change no content

### 4. Seed and verify

After the key file is deployed: run the script with `--sitemap` once to seed every public URL. Expect `202` on the first submission. A day or two later, confirm receipt in Bing Webmaster Tools → IndexNow.

## Gotchas

- Submitting **before** the key file is live fails validation — always deploy the key file first, poll the URL, then submit.
- URLs must belong to the exact host in the payload (`www.` vs apex mismatch → 422). Use the canonical host everywhere.
- CMS users may not need any of this: WordPress (Yoast/RankMath/AIOSEO), Shopify plugins, and Cloudflare Crawler Hints already do IndexNow.
- Key rotation: replace the `<key>.txt` file with a new 32-hex-named file; engines pick up the new key on the next submission.
