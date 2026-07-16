/**
 * Submit URLs to IndexNow (api.indexnow.org fans out to Bing, Yandex,
 * Seznam, Naver, and other participating engines). Dependency-free, Node 18+.
 *
 * Usage:
 *   node indexnow-submit.mjs --site https://www.example.com --urls <url...>
 *   node indexnow-submit.mjs --site https://www.example.com --sitemap [url]
 *
 * Options:
 *   --site <origin>   Canonical site origin (or SITE_URL env var). Required.
 *   --key <key>       IndexNow key. Optional if public/<32-hex>.txt exists
 *                     in the current working directory's project.
 *   --urls <url...>   Submit explicit URLs.
 *   --sitemap [url]   Fetch the sitemap XML (default <site>/sitemap.xml)
 *                     and submit every <loc>. First-time seeding only —
 *                     IndexNow wants changed URLs, not periodic re-dumps.
 *   --dry-run         Print the payload without POSTing.
 *
 * Extending with a --changed mode (recommended for CI):
 *   The highest-signal automation submits only URLs whose content changed.
 *   If your sitemap is generated from a source file with per-route
 *   lastModified dates, add a mode that parses that file at an old git ref
 *   (`git show <ref>:path/to/sitemap.ts`) vs the working tree and submits
 *   routes that are new, have a bumped date, or were removed. Wire it to a
 *   GitHub Action triggered on push to main with a paths filter on the
 *   sitemap source. See the SKILL.md for the workflow YAML.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function fail(message) {
  console.error(`indexnow: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    site: process.env.SITE_URL ?? null,
    key: null,
    mode: null,
    urls: [],
    sitemapUrl: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--site") {
      args.site = argv[++i] ?? fail("--site requires an origin");
    } else if (arg === "--key") {
      args.key = argv[++i] ?? fail("--key requires a value");
    } else if (arg === "--urls") {
      args.mode = "urls";
      args.urls = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args.urls.push(argv[++i]);
      }
      if (args.urls.length === 0) fail("--urls requires at least one URL");
    } else if (arg === "--sitemap") {
      args.mode = "sitemap";
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.sitemapUrl = next;
        i++;
      }
    } else {
      fail(`unknown argument "${arg}"`);
    }
  }
  if (!args.site) fail("--site <origin> (or SITE_URL env var) is required");
  if (!args.mode) fail("one of --urls <url...> or --sitemap [url] is required");
  args.site = args.site.replace(/\/$/, "");
  return args;
}

/** Look for a committed public/<32-hex>.txt key file (the usual convention). */
function discoverKey() {
  try {
    const publicDir = join(process.cwd(), "public");
    const keyFile = readdirSync(publicDir).find((name) =>
      /^[0-9a-f]{32}\.txt$/.test(name),
    );
    if (!keyFile) return null;
    const key = readFileSync(join(publicDir, keyFile), "utf8").trim();
    return key === keyFile.replace(/\.txt$/, "") ? key : null;
  } catch {
    return null;
  }
}

async function fetchSitemapUrls(sitemapUrl) {
  const response = await fetch(sitemapUrl);
  if (!response.ok) {
    fail(`could not fetch sitemap ${sitemapUrl} (HTTP ${response.status})`);
  }
  const xml = await response.text();
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(
    (m) => m[1],
  );
  if (urls.length === 0) fail(`no <loc> entries found in ${sitemapUrl}`);
  return urls;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = args.key ?? discoverKey();
  if (!key) {
    fail("no key: pass --key or commit public/<32-hex-key>.txt");
  }

  const urls =
    args.mode === "sitemap"
      ? await fetchSitemapUrls(args.sitemapUrl ?? `${args.site}/sitemap.xml`)
      : args.urls;

  const host = new URL(args.site).host;
  const foreign = urls.filter((u) => new URL(u).host !== host);
  if (foreign.length > 0) {
    fail(`URLs don't belong to ${host} (would 422): ${foreign.join(", ")}`);
  }

  const payload = {
    host,
    key,
    keyLocation: `${args.site}/${key}.txt`,
    urlList: urls,
  };

  console.log(`indexnow: submitting ${urls.length} URL(s):`);
  for (const url of urls) console.log(`  ${url}`);

  if (args.dryRun) {
    console.log("indexnow: dry run — payload:");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });

  if (response.status === 200 || response.status === 202) {
    console.log(`indexnow: submitted successfully (HTTP ${response.status})`);
    if (response.status === 202) {
      console.log(
        "indexnow: 202 = received, key validation pending (normal on first submission)",
      );
    }
    return;
  }
  const body = await response.text();
  fail(`submission failed (HTTP ${response.status}): ${body}`);
}

main().catch((error) => fail(error.message));
