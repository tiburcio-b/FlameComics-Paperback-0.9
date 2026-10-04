# btninja Paperback 0.9 Extensions

Rebuildable Paperback 0.9 extension repository for:

- `https://flamecomics.xyz`
- `https://qimanga.com`
- `https://mangak.io`

## Install Page

Open the install page on a device with Paperback installed:

```text
https://tiburcio-b.github.io/FlameComics-Paperback-0.9/stable/
```

Paperback repository base URL:

```text
https://tiburcio-b.github.io/FlameComics-Paperback-0.9
```

## Commands

```bash
npm install
npm test -- --run
npm run build
npm run verify:live
npm run check
```

## Output

`npm run build` writes the deployable repository to:

```text
dist/0.9/FlameComics/index.js
dist/0.9/FlameComics/info.json
dist/0.9/QiManga/index.js
dist/0.9/QiManga/info.json
dist/0.9/MangaK/index.js
dist/0.9/MangaK/info.json
dist/0.9/versioning.json
dist/0.9/index.html
dist/0.9/stable/FlameComics/index.js
dist/0.9/stable/FlameComics/info.json
dist/0.9/stable/QiManga/index.js
dist/0.9/stable/QiManga/info.json
dist/0.9/stable/MangaK/index.js
dist/0.9/stable/MangaK/info.json
dist/0.9/stable/versioning.json
```

Host `dist/0.9` as the Paperback 0.9 source repo URL. The build mirrors the native repo under `/stable` too for older install links.

## Notes

Builds use the native Paperback 0.9 `paperback-cli bundle` toolchain and wrapper folders under `src/<Source>/`.

FlameComics uses current Next.js data routes. QiManga uses the public `https://api.qimanga.com/api/v1` API. MangaK uses its server-rendered Next.js `__NEXT_DATA__` payloads from `https://mangak.io`. `npm run verify:live` checks live discover sections, one manga, chapter pages, and search results for all sources.
