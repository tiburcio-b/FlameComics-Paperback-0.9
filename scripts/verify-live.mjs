import {
  extractBuildId,
  findChapterToken,
  mapChapterDetails,
  mapChapters,
  mapDiscoverSections,
  mapMangaDetails,
  mapSearchResults
} from "../src/flameParser.ts";
import {
  QIMANGA_API_DOMAIN,
  mapQiChapterDetails,
  mapQiChapters,
  mapQiDiscoverSectionItems,
  mapQiDiscoverSections,
  mapQiMangaDetails,
  mapQiSearchResults
} from "../src/qiMangaParser.ts";
import {
  MANGAK_DOMAIN,
  extractMangaKNextData,
  mapMangaKChapterDetails,
  mapMangaKChapters,
  mapMangaKDiscoverSectionItems,
  mapMangaKDiscoverSections,
  mapMangaKMangaDetails,
  mapMangaKSearchResults
} from "../src/mangaKParser.ts";

const FLAME_DOMAIN = "https://flamecomics.xyz";
const QIMANGA_DOMAIN = "https://qimanga.com";

/** QiManga's API is called cross-origin, exactly as the extension calls it. */
async function fetchJson(url) {
  return fetchJsonWithHeaders(url, {
    "origin": QIMANGA_DOMAIN,
    "referer": `${QIMANGA_DOMAIN}/`
  });
}

/** Flame's data routes are same-origin documents: referer only, no origin. */
async function fetchFlameJson(url) {
  return fetchJsonWithHeaders(url, { "referer": `${FLAME_DOMAIN}/` });
}

async function fetchJsonWithHeaders(url, headers) {
  const response = await fetch(url, {
    headers: {
      ...headers,
      "user-agent": "Paperback-Repository-Verification/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return response.json();
}

async function fetchMangaKPage(path) {
  const response = await fetch(`${MANGAK_DOMAIN}${path}`, {
    headers: {
      "referer": `${MANGAK_DOMAIN}/`,
      "user-agent": "Paperback-Repository-Verification/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`GET ${MANGAK_DOMAIN}${path} failed with ${response.status}`);
  }
  return extractMangaKNextData(await response.text());
}

/**
 * A broken thumbnail is invisible in a payload check: the URL parses fine and
 * only fails when something actually fetches it. So fetch it.
 */
async function assertImagesLoad(source, urls) {
  for (const url of urls.filter(Boolean)) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": "Paperback-Repository-Verification/1.0"
      }
    });

    if (!response.ok) {
      throw new Error(`${source} image ${url} responded with ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new Error(`${source} image ${url} returned ${contentType || "no content type"}`);
    }

    await response.arrayBuffer();
  }
}

async function main() {
  const homepage = await fetch(FLAME_DOMAIN, {
    headers: {
      "user-agent": "Paperback-Repository-Verification/1.0"
    }
  }).then((response) => response.text());
  const buildId = extractBuildId(homepage);

  const indexPayload = await fetchFlameJson(
    `${FLAME_DOMAIN}/_next/data/${buildId}/index.json`
  );
  const sections = mapDiscoverSections(indexPayload);
  if (sections.length !== 3 || sections.some((section) => section.items.length === 0)) {
    throw new Error("Live homepage sections did not produce populated items");
  }

  const firstManga = sections.find((section) => section.items.length > 0).items[0];
  const seriesPayload = await fetchFlameJson(
    `${FLAME_DOMAIN}/_next/data/${buildId}/series/${firstManga.mangaId}.json?id=${firstManga.mangaId}`
  );
  const mangaDetails = mapMangaDetails(firstManga.mangaId, seriesPayload);
  const chapters = mapChapters({ mangaId: firstManga.mangaId }, seriesPayload);
  if (!mangaDetails.mangaInfo.primaryTitle || chapters.length === 0) {
    throw new Error("Live series details did not produce title and chapters");
  }
  await assertImagesLoad("flameComics", [
    mangaDetails.mangaInfo.thumbnailUrl,
    ...sections.flatMap((section) => section.items.slice(0, 1).map((item) => item.imageUrl))
  ]);

  const chapter = chapters[0];
  const token = findChapterToken(chapter.chapterId, seriesPayload);
  const chapterPayload = await fetchFlameJson(
    `${FLAME_DOMAIN}/_next/data/${buildId}/series/${firstManga.mangaId}/${token}.json?id=${firstManga.mangaId}&token=${token}`
  );
  const chapterDetails = mapChapterDetails(firstManga.mangaId, token, chapterPayload);
  if (chapterDetails.pages.length === 0) {
    throw new Error("Live chapter details did not produce page URLs");
  }

  const searchPayload = await fetchFlameJson(
    `${FLAME_DOMAIN}/_next/data/${buildId}/browse.json`
  );
  const searchResults = mapSearchResults({ title: "solo" }, searchPayload);
  if (searchResults.items.length === 0) {
    throw new Error("Live search did not produce results");
  }
  if (searchResults.items.some((item) => !item.imageUrl.startsWith("http"))) {
    throw new Error("Live search produced results without absolute cover URLs");
  }

  const qiHomePayload = await fetchJson(`${QIMANGA_API_DOMAIN}/v1/home`);
  const qiSections = mapQiDiscoverSections();
  const qiNewItems = mapQiDiscoverSectionItems("new", qiHomePayload);
  if (qiSections.length !== 5 || qiNewItems.items.length === 0) {
    throw new Error("Live QiManga homepage did not produce populated items");
  }

  const qiFirstManga = qiNewItems.items[0];
  const qiSeriesPayload = await fetchJson(
    `${QIMANGA_API_DOMAIN}/v1/series/${qiFirstManga.mangaId}`
  );
  const qiMangaDetails = mapQiMangaDetails(qiFirstManga.mangaId, qiSeriesPayload);
  const qiChaptersPayload = await fetchJson(
    `${QIMANGA_API_DOMAIN}/v1/series/${qiFirstManga.mangaId}/chapters?page=1&perPage=30&sort=desc`
  );
  const qiChapters = mapQiChapters({ mangaId: qiFirstManga.mangaId }, qiChaptersPayload);
  if (!qiMangaDetails.mangaInfo.primaryTitle || qiChapters.length === 0) {
    throw new Error("Live QiManga series details did not produce title and chapters");
  }

  const qiChapterPayload = await fetchJson(
    `${QIMANGA_API_DOMAIN}/v1/series/${qiFirstManga.mangaId}/chapters/${qiFirstManga.chapterId}`
  );
  const qiChapterDetails = mapQiChapterDetails(
    {
      chapterId: qiFirstManga.chapterId,
      sourceManga: { mangaId: qiFirstManga.mangaId }
    },
    qiChapterPayload
  );
  if (qiChapterDetails.pages.length === 0) {
    throw new Error("Live QiManga chapter details did not produce page URLs");
  }
  await assertImagesLoad("qiManga", [
    qiMangaDetails.mangaInfo.thumbnailUrl,
    qiNewItems.items[0].imageUrl
  ]);

  const qiSearchPayload = await fetchJson(
    `${QIMANGA_API_DOMAIN}/v1/series/search?q=immortal&page=1&perPage=20`
  );
  const qiSearchResults = mapQiSearchResults(qiSearchPayload);
  if (qiSearchResults.items.length === 0) {
    throw new Error("Live QiManga search did not produce results");
  }

  const mangaKHomePayload = await fetchMangaKPage("/home");
  const mangaKSections = mapMangaKDiscoverSections();
  const mangaKLatestItems = mapMangaKDiscoverSectionItems("latest", mangaKHomePayload);
  if (mangaKSections.length !== 5 || mangaKLatestItems.items.length === 0) {
    throw new Error("Live MangaK homepage did not produce populated items");
  }

  const mangaKFirstManga = mangaKLatestItems.items[0];
  const mangaKSeriesPayload = await fetchMangaKPage(`/${mangaKFirstManga.mangaId}`);
  const mangaKMangaDetails = mapMangaKMangaDetails(
    mangaKFirstManga.mangaId,
    mangaKSeriesPayload
  );
  const mangaKChapters = mapMangaKChapters(
    { mangaId: mangaKFirstManga.mangaId },
    mangaKSeriesPayload
  );
  if (!mangaKMangaDetails.mangaInfo.primaryTitle || mangaKChapters.length === 0) {
    throw new Error("Live MangaK series details did not produce title and chapters");
  }

  const mangaKChapter = mangaKChapters[mangaKChapters.length - 1];
  const mangaKChapterPayload = await fetchMangaKPage(
    `/${mangaKFirstManga.mangaId}/${mangaKChapter.chapterId}`
  );
  const mangaKChapterDetails = mapMangaKChapterDetails(
    {
      chapterId: mangaKChapter.chapterId,
      sourceManga: { mangaId: mangaKFirstManga.mangaId }
    },
    mangaKChapterPayload
  );
  if (mangaKChapterDetails.pages.length === 0) {
    throw new Error("Live MangaK chapter details did not produce page URLs");
  }
  await assertImagesLoad("mangaK", [
    mangaKMangaDetails.mangaInfo.thumbnailUrl,
    mangaKLatestItems.items[0].imageUrl
  ]);

  const mangaKSearchPayload = await fetchMangaKPage("/search?keyword=immortal&page=1");
  const mangaKSearchResults = mapMangaKSearchResults(mangaKSearchPayload);
  if (mangaKSearchResults.items.length === 0) {
    throw new Error("Live MangaK search did not produce results");
  }

  console.log(
    JSON.stringify(
      {
        flameComics: {
          buildId,
          sectionCount: sections.length,
          sampledManga: mangaDetails.mangaInfo.primaryTitle,
          sampledChapters: chapters.length,
          sampledPages: chapterDetails.pages.length,
          searchResults: searchResults.items.length
        },
        qiManga: {
          sectionCount: qiSections.length,
          sampledManga: qiMangaDetails.mangaInfo.primaryTitle,
          sampledChapters: qiChapters.length,
          sampledPages: qiChapterDetails.pages.length,
          searchResults: qiSearchResults.items.length
        },
        mangaK: {
          sectionCount: mangaKSections.length,
          sampledManga: mangaKMangaDetails.mangaInfo.primaryTitle,
          sampledChapters: mangaKChapters.length,
          sampledPages: mangaKChapterDetails.pages.length,
          searchResults: mangaKSearchResults.items.length
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
