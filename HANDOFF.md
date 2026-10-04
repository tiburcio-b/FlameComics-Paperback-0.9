# Handoff: Paperback 0.9 Extensions

## Current State

This folder contains a rebuildable Paperback 0.9 extension repository for three sources:

- FlameComics: `https://flamecomics.xyz`
- QiManga: `https://qimanga.com`
- MangaK: `https://mangak.io`

Local path:

```text
/Users/bryan/Documents/FlameComics-Paperback-0.9
```

Remote:

```text
https://github.com/tiburcio-b/FlameComics-Paperback-0.9
```

Install page and Paperback repository base URL:

```text
https://tiburcio-b.github.io/FlameComics-Paperback-0.9/stable/
https://tiburcio-b.github.io/FlameComics-Paperback-0.9
```

## Project Layout

- `src/extension.ts`: FlameComics runtime extension
- `src/flameParser.ts`: FlameComics parser helpers
- `src/urlUtils.ts`: shared cover/page URL normalisation used by all three parsers
- `src/qiMangaExtension.ts`: QiManga runtime extension
- `src/qiMangaParser.ts`: QiManga parser helpers
- `src/mangaKExtension.ts`: MangaK runtime extension
- `src/mangaKParser.ts`: MangaK parser helpers
- `src/FlameComics/main.ts`, `src/FlameComics/pbconfig.ts`: native Paperback 0.9 build wrapper
- `src/QiManga/main.ts`, `src/QiManga/pbconfig.ts`: native Paperback 0.9 build wrapper
- `src/MangaK/main.ts`, `src/MangaK/pbconfig.ts`: native Paperback 0.9 build wrapper
- `scripts/build-repo.mjs`: runs `paperback-cli bundle` and copies `bundles` into both `dist/0.9` and `dist/0.9/stable`
- `scripts/repository-metadata.mjs`: repository and source metadata
- `scripts/repository-page.mjs`: install page renderer
- `scripts/verify-live.mjs`: live source smoke verifier
- `assets/icon.png`: FlameComics icon
- `assets/qimanga-icon.png`: QiManga icon converted from `https://qimanga.com/qiscans.ico`
- `assets/mangak-icon.png`: MangaK icon from `https://mangak.io/static/sites/mangak/icons/android-chrome-512x512.png`
- `test/`: parser, runtime, metadata, and page tests

## QiManga API Notes

QiManga (QiScans) is backed by:

```text
https://api.qimanga.com/api/v1
```

Endpoints the extension uses:

```text
GET /series?page=1&perPage=20&sort=latest|popular|newest|alphabetical
GET /series/search?q={query}&page=1&perPage=20
GET /series/{slug}
GET /series/{slug}/chapters?page=1&perPage=100&sort=desc
GET /series/{slug}/chapters/{chapterSlug}
```

Series list and search both answer with `{ data, totalPages, current }`.
Paging follows `current < totalPages`; there is no `next` cursor.

Chapters have **no publish-status field**. A chapter is readable unless
`requiresPurchase` is true. Requiring a `publishStatus` of `PUBLIC` matched
nothing and emptied every chapter list.

Genres carry only a `name`, so the tag id is derived from it.

Discover is built from `/series` with the sort values above rather than
`/home`, which is not part of the documented surface.

The API is called cross-origin from the site and expects it: `Origin`,
`Referer`, `Accept: application/json, text/plain, */*` and
`Sec-Fetch-Dest/Mode/Site`. Image requests carry none of that.

## MangaK Notes

MangaK (formerly MangaBuddy) splits across a JSON API and its Next.js pages:

```text
https://api.mangak.io   list, search and chapter data
https://mangak.io       series and chapter pages (Next.js pageProps)
```

Endpoints the extension uses:

```text
GET  api/titles/search?q={query}&page=1&limit=24&sort=popular|latest[&window=week]
GET  api/titles/{seriesId}/chapters?cv={timestamp}
GET  site/{seriesPath}                     -> pageProps.initialManga
GET  site/{chapterPath}                    -> pageProps.initialChapter.images
```

Search answers with `{ data: { items, pagination: { has_next } } }`, and each
item carries `{ id, name, cover, url }`. `url` is a site-relative path and is
used as the Paperback `mangaId`; `id` is the API id and is the **only** key the
chapter list accepts, so it is kept in `additionalInfo.seriesId` and re-read
from the series page when a stored title predates it.

The chapter list is no longer embedded in the series page — reading
`initialManga.chapters` returns nothing. Search is no longer server-rendered
into `ssrItems` either; both moved to the API.

Search queries are stripped of punctuation and capped at 50 characters, which
is what the endpoint accepts.

Cover and page hosts rotate (`rx.<something>.org`). The parser keeps whatever
absolute URL the payload carries rather than assuming a host.

## Paperback Runtime Constraints

The app's JavaScript runtime is not a browser or Node:

- There is no `URLSearchParams` (or `URL`). Build query strings with
  `buildQueryString` in `src/urlUtils.ts`, which matches its output.
- Manga, chapter and tag ids may only contain ASCII letters, digits and
  `._-@()[]%?#+=/&:`. Site slugs often carry apostrophes, so QiManga and MangaK
  ids go through `encodePaperbackId` (`src/paperbackIds.ts`) and are decoded
  with `decodePaperbackId` before they are put back into a request. Ids that
  were already valid are left byte-for-byte unchanged so library entries keep
  matching.

## FlameComics Data Route Fallback

The cached build id goes stale whenever Flame redeploys. A stale
`_next/data/<buildId>/...json` route may answer 404 **or a 200 HTML page**; the
latter used to surface in the app as `JSON Parse error: Unrecognized token '<'`.

Any data-route answer that is not a JSON `pageProps` payload is now treated as
stale: the build id is re-read from the homepage and the route retried. If that
still fails, the extension reads the same `pageProps` out of the
server-rendered page's `__NEXT_DATA__` (`/`, `/browse`, `/series/<id>`,
`/series/<id>/<token>`) and keeps doing so for the rest of the session. A
Cloudflare interstitial is raised as a `CloudflareError` so the app offers its
bypass, and any other unexpected page is reported by its `<title>`.

## Verification

```bash
npm test -- --run   # unit + parser + bundle contract tests
npm run build       # paperback-cli bundle into dist/0.9 and dist/0.9/stable
npm run verify:live # live smoke test against all three sites
```

`npm run check` runs all three in sequence.

`verify:live` checks all three sources independently — one source being down
no longer hides a regression in another — and it fetches the cover URLs the
parsers produce, asserting each returns an `image/*` response. A thumbnail that
404s is invisible in a payload-shape check and only shows up in the app.

It also asserts that each source's chapter list parses to a non-zero count.
That is the check that would have caught QiManga silently filtering every
chapter away.

### Cover and search notes

FlameComics cover URLs are
`https://cdn.flamecomics.xyz/uploads/images/series/<series_id>/<cover>?<last_edit>`
and chapter pages are
`https://cdn.flamecomics.xyz/uploads/images/series/<series_id>/<token>/<name>?<release_date>`.
The bare trailing query value is a cache-buster, not a named parameter.

FlameComics search reads `_next/data/<buildId>/browse.json` with **no** query
parameters: that route is a prerendered document containing the whole
catalogue, and the extension filters and pages it locally over `title` plus
`altTitles`. Sending a `search=` parameter risks a 404 from the data route,
which surfaces in the app as a failed search.

On Flame, `author` and `artist` are lists, and series carry `views` (there is
no `likes` field).

Requests carry a `Referer` and user agent. `Origin` is only sent for QiManga's
cross-origin API calls; browsers never send it for image loads, and sending it
anyway is an easy way to earn a CDN 403 on cover art.

## Useful Commands

```bash
npm install
npm test -- --run
npm run build
npm run verify:live
npm run check
git status -sb
git log --oneline --decorate -5
```
