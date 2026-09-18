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
  QIMANGA_DOMAIN,
  mapQiChapterDetails,
  mapQiChapters,
  mapQiDiscoverSectionItems,
  mapQiDiscoverSections,
  mapQiMangaDetails,
  mapQiSearchResults
} from "../src/qiMangaParser.ts";
import {
  MANGAK_API_DOMAIN,
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
const USER_AGENT = "Paperback-Repository-Verification/1.0";

async function fetchJsonWithHeaders(url, headers) {
  const response = await fetch(url, {
    headers: { ...headers, "user-agent": USER_AGENT }
  });
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return response.json();
}

/** Flame's data routes are same-origin documents: referer only, no origin. */
async function fetchFlameJson(url) {
  return fetchJsonWithHeaders(url, { referer: `${FLAME_DOMAIN}/` });
}

/** QiManga's API is called cross-origin, exactly as the extension calls it. */
async function fetchQiJson(path) {
  return fetchJsonWithHeaders(`${QIMANGA_API_DOMAIN}/${path}`, {
    accept: "application/json, text/plain, */*",
    origin: QIMANGA_DOMAIN,
    referer: `${QIMANGA_DOMAIN}/`,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site"
  });
}

async function fetchMangaKApi(path) {
  return fetchJsonWithHeaders(`${MANGAK_API_DOMAIN}${path}`, {
    accept: "application/json, text/plain, */*",
    origin: MANGAK_DOMAIN,
    referer: `${MANGAK_DOMAIN}/`
  });
}

async function fetchMangaKPage(path) {
  const response = await fetch(`${MANGAK_DOMAIN}${path}`, {
    headers: { referer: `${MANGAK_DOMAIN}/`, "user-agent": USER_AGENT }
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
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });

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

function assertCovers(source, items) {
  const missing = items.filter((item) => !item.imageUrl?.startsWith("http"));
  if (missing.length > 0) {
    throw new Error(
      `${source} produced ${missing.length}/${items.length} items without an absolute cover URL`
    );
  }
}

async function verifyFlameComics() {
  const homepage = await fetch(FLAME_DOMAIN, {
    headers: { "user-agent": USER_AGENT }
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
  await assertImagesLoad("flameComics", [mangaDetails.mangaInfo.thumbnailUrl]);

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
  assertCovers("flameComics", searchResults.items);

  return {
    buildId,
    sectionCount: sections.length,
    sampledManga: mangaDetails.mangaInfo.primaryTitle,
    sampledChapters: chapters.length,
    sampledPages: chapterDetails.pages.length,
    searchResults: searchResults.items.length
  };
}

async function verifyQiManga() {
  const sections = mapQiDiscoverSections();
  const browsePayload = await fetchQiJson("v1/series?page=1&perPage=20&sort=popular");
  const popular = mapQiDiscoverSectionItems("popular", browsePayload, 1);
  if (sections.length === 0 || popular.items.length === 0) {
    throw new Error("Live QiManga discover did not produce populated items");
  }
  assertCovers("qiManga", popular.items);

  const first = popular.items[0];
  const seriesPayload = await fetchQiJson(`v1/series/${first.mangaId}`);
  const details = mapQiMangaDetails(first.mangaId, seriesPayload);

  const chaptersPayload = await fetchQiJson(
    `v1/series/${first.mangaId}/chapters?page=1&perPage=100&sort=desc`
  );
  const chapters = mapQiChapters({ mangaId: first.mangaId }, chaptersPayload);
  if (!details.mangaInfo.primaryTitle) {
    throw new Error("Live QiManga series details did not produce a title");
  }
  // This is the check that would have caught the publish-status filter that
  // silently emptied every chapter list.
  if (chapters.length === 0) {
    throw new Error(
      `Live QiManga chapter list for ${first.mangaId} parsed to zero readable chapters`
    );
  }
  await assertImagesLoad("qiManga", [details.mangaInfo.thumbnailUrl]);

  const chapterPayload = await fetchQiJson(
    `v1/series/${first.mangaId}/chapters/${chapters[0].chapterId}`
  );
  const chapterDetails = mapQiChapterDetails(
    { chapterId: chapters[0].chapterId, sourceManga: { mangaId: first.mangaId } },
    chapterPayload
  );
  if (chapterDetails.pages.length === 0) {
    throw new Error("Live QiManga chapter details did not produce page URLs");
  }

  const searchPayload = await fetchQiJson(
    "v1/series/search?q=immortal&page=1&perPage=20"
  );
  const searchResults = mapQiSearchResults(searchPayload, 1);
  if (searchResults.items.length === 0) {
    throw new Error("Live QiManga search did not produce results");
  }
  assertCovers("qiManga", searchResults.items);

  return {
    sectionCount: sections.length,
    sampledManga: details.mangaInfo.primaryTitle,
    sampledChapters: chapters.length,
    sampledPages: chapterDetails.pages.length,
    searchResults: searchResults.items.length
  };
}

async function verifyMangaK() {
  const sections = mapMangaKDiscoverSections();
  const latestPayload = await fetchMangaKApi(
    "/titles/search?sort=latest&page=1&limit=24"
  );
  const latest = mapMangaKDiscoverSectionItems("latest", latestPayload, 1);
  if (sections.length === 0 || latest.items.length === 0) {
    throw new Error("Live MangaK discover did not produce populated items");
  }
  assertCovers("mangaK", latest.items);

  const first = latest.items[0];
  const seriesPayload = await fetchMangaKPage(`/${first.mangaId}`);
  const details = mapMangaKMangaDetails(first.mangaId, seriesPayload);
  if (!details.mangaInfo.primaryTitle) {
    throw new Error("Live MangaK series details did not produce a title");
  }
  await assertImagesLoad("mangaK", [details.mangaInfo.thumbnailUrl]);

  const seriesId = details.mangaInfo.additionalInfo.seriesId;
  if (!seriesId) {
    throw new Error(`Live MangaK details for ${first.mangaId} carried no series id`);
  }

  const chaptersPayload = await fetchMangaKApi(
    `/titles/${seriesId}/chapters?cv=${Date.now()}`
  );
  const chapters = mapMangaKChapters({ mangaId: first.mangaId }, chaptersPayload);
  if (chapters.length === 0) {
    throw new Error(
      `Live MangaK chapter list for ${first.mangaId} parsed to zero chapters`
    );
  }

  const chapter = chapters[chapters.length - 1];
  const chapterPayload = await fetchMangaKPage(`/${chapter.chapterId}`);
  const chapterDetails = mapMangaKChapterDetails(
    { chapterId: chapter.chapterId, sourceManga: { mangaId: first.mangaId } },
    chapterPayload
  );
  if (chapterDetails.pages.length === 0) {
    throw new Error("Live MangaK chapter details did not produce page URLs");
  }

  const searchPayload = await fetchMangaKApi(
    "/titles/search?q=immortal&page=1&limit=24"
  );
  const searchResults = mapMangaKSearchResults(searchPayload, 1);
  if (searchResults.items.length === 0) {
    throw new Error("Live MangaK search did not produce results");
  }
  assertCovers("mangaK", searchResults.items);

  return {
    sectionCount: sections.length,
    sampledManga: details.mangaInfo.primaryTitle,
    sampledChapters: chapters.length,
    sampledPages: chapterDetails.pages.length,
    searchResults: searchResults.items.length
  };
}

async function main() {
  const results = {};
  const failures = [];

  // Verify every source even when one is down, so a single outage does not
  // hide a second regression.
  for (const [name, verify] of [
    ["flameComics", verifyFlameComics],
    ["qiManga", verifyQiManga],
    ["mangaK", verifyMangaK]
  ]) {
    try {
      results[name] = await verify();
    } catch (error) {
      results[name] = { failed: String(error?.message ?? error) };
      failures.push(name);
    }
  }

  console.log(JSON.stringify(results, null, 2));

  if (failures.length > 0) {
    throw new Error(`Live verification failed for: ${failures.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
