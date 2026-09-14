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
git@github.com:btninja/FlameComics-Paperback-0.9.git
```

Install page and Paperback repository base URL:

```text
https://btninja.github.io/FlameComics-Paperback-0.9/stable/
https://btninja.github.io/FlameComics-Paperback-0.9
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

QiManga is an Angular/SSR app backed by:

```text
https://api.qimanga.com/api/v1
```

Useful endpoints:

```text
GET /home
GET /series/{slug}
GET /series/{slug}/chapters?page=1&perPage=30&sort=desc
GET /series/{slug}/chapters/{chapterSlug}
GET /series/search?q={query}&page=1&perPage=20
GET /series?page=1&perPage=20&sort=latest
GET /series/genres
```

The extension filters out paid or purchase-required chapters because those are not readable as normal public chapters. Chapter pagination is fetched fully and sorted after all pages are collected.

## MangaK Notes

MangaK is a Next.js app backed by server-rendered page data. The extension fetches public HTML pages and parses the `__NEXT_DATA__` payloads:

```text
GET /home
GET /{slug}
GET /{slug}/{chapterSlug}
GET /search?keyword={query}&page={page}
```

The live payloads include homepage sections, series details, chapter lists, reader image URLs, and search pagination. MangaK metadata is marked `ADULT` because the public catalog includes adult entries.

## Verification

```bash
npm test -- --run   # unit + parser + bundle contract tests
npm run build       # paperback-cli bundle into dist/0.9 and dist/0.9/stable
npm run verify:live # live smoke test against all three sites
```

`npm run check` runs all three in sequence.

`verify:live` now also fetches the cover URLs the parsers produce and asserts
each one returns an `image/*` response. A thumbnail that 404s or returns HTML
is invisible in a payload-shape check and only shows up in the app, so the
verifier fetches them.

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
