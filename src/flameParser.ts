import { resolveImageUrl, withVersion } from "./urlUtils";

export const FLAME_DOMAIN = "https://flamecomics.xyz";
export const FLAME_CDN_DOMAIN = "https://cdn.flamecomics.xyz";
export const IMAGE_SERIES_PATH = "uploads/images/series";
export const IMAGE_CAROUSEL_PATH = "uploads/images/carousel";
export const SEARCH_PAGE_SIZE = 20;
export const DiscoverSectionType = {
  featured: 0,
  simpleCarousel: 1
} as const;

export type SourceMangaRef = {
  mangaId: string;
  title?: string;
};

export type SearchQuery = {
  title?: string;
};

export type SearchPageMetadata = {
  page: number;
};

type FlameSeriesPreview = {
  series_id?: number | string;
  title?: string;
  altTitles?: string[];
  views?: number;
  status?: string;
  type?: string;
  cover?: string;
  image?: string;
  last_edit?: number | string;
};

type FlameChapterPreview = {
  chapter_id?: number | string;
  chapter?: number | string;
  title?: string | null;
  release_date?: number | string;
  series_id?: number | string;
  token?: string;
};

export function extractBuildId(html: string): string {
  const nextData = extractNextData(html);
  if (!nextData) {
    throw new Error("Unable to find __NEXT_DATA__ script");
  }

  if (!nextData.buildId || typeof nextData.buildId !== "string") {
    throw new Error("Unable to find buildId in __NEXT_DATA__");
  }

  return nextData.buildId;
}

/**
 * The `__NEXT_DATA__` document a server-rendered page embeds. Its
 * `props.pageProps` is the same object the `_next/data` route returns as
 * `pageProps`, which makes the page itself a fallback for that route.
 */
export function extractNextData(html: string): Record<string, any> | undefined {
  const scriptMatch = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/
  );
  if (!scriptMatch?.[1]) {
    return undefined;
  }

  // Script contents are raw text, so entities are only a fallback.
  for (const candidate of [scriptMatch[1], decodeHtmlEntities(scriptMatch[1])]) {
    const parsed = parseJson(candidate);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, any>;
    }
  }

  return undefined;
}

/**
 * A `_next/data` payload, or `undefined` when the body is not one: an HTML
 * page (a stale build id can be answered with one and a 200), an empty
 * middleware redirect, or anything else without `pageProps`.
 */
export function parseNextDataPayload(body: string): { pageProps: Record<string, any> } | undefined {
  const parsed = parseJson(body) as { pageProps?: unknown } | undefined;
  const pageProps = parsed?.pageProps;
  if (!pageProps || typeof pageProps !== "object") {
    return undefined;
  }
  if ("__N_REDIRECT" in pageProps) {
    return undefined;
  }

  return { pageProps: pageProps as Record<string, any> };
}

/** Cloudflare's interstitial, as opposed to a page that merely loads its scripts. */
export function isCloudflareChallenge(html: string): boolean {
  return (
    /<title>\s*(Just a moment|Attention Required)/i.test(html) ||
    html.includes("_cf_chl_opt") ||
    html.includes("cf-browser-verification")
  );
}

/** First bit of a response worth putting in an error message. */
export function describeHtml(html: string): string {
  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  if (title) {
    return `page "${title.slice(0, 80)}"`;
  }

  const snippet = cleanText(html).slice(0, 80);
  return snippet ? `"${snippet}"` : "an empty response";
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function mapDiscoverSectionList(payload: unknown) {
  return mapDiscoverSections(payload).map(({ id, title, type }) => ({
    id,
    title,
    type
  }));
}

export function mapDiscoverSections(payload: unknown) {
  const pageProps = getPageProps(payload);
  const carousel = asArray<FlameSeriesPreview>(pageProps.carousel);
  const popular = asArray<FlameSeriesPreview>(
    pageProps.popularEntries?.blocks?.[0]?.series
  );
  const latest = asArray<FlameSeriesPreview>(
    pageProps.latestEntries?.blocks?.[0]?.series
  );

  return [
    {
      id: "featured",
      title: "Featured",
      type: DiscoverSectionType.featured,
      items: carousel
        .filter((comic) => comic.series_id != null)
        .map((comic) => ({
          type: "featuredCarouselItem",
          mangaId: String(comic.series_id),
          imageUrl: carouselImageUrl(comic),
          title: cleanText(comic.title)
        }))
    },
    {
      id: "popular",
      title: "Popular",
      type: DiscoverSectionType.simpleCarousel,
      items: popular
        .filter((comic) => comic.series_id != null)
        .map((comic) => ({
          type: "simpleCarouselItem",
          mangaId: String(comic.series_id),
          imageUrl: seriesCoverUrl(comic),
          title: cleanText(comic.title),
          subtitle: previewSubtitle(comic)
        }))
    },
    {
      id: "latest",
      title: "Latest",
      type: DiscoverSectionType.simpleCarousel,
      items: latest
        .filter((comic) => comic.series_id != null)
        .map((comic) => ({
          type: "simpleCarouselItem",
          mangaId: String(comic.series_id),
          imageUrl: seriesCoverUrl(comic),
          title: cleanText(comic.title),
          subtitle: cleanText(comic.status)
        }))
    }
  ];
}

export function mapDiscoverSectionItems(sectionId: string, payload: unknown) {
  const section = mapDiscoverSections(payload).find(({ id }) => id === sectionId);
  if (!section) {
    return { items: [], metadata: undefined };
  }

  return { items: section.items, metadata: undefined };
}

export function mapMangaDetails(mangaId: string, payload: unknown) {
  const series = getPageProps(payload).series;
  if (!series) {
    throw new Error(`Unable to parse FlameComics series ${mangaId}`);
  }

  const tags = [
    cleanText(series.type),
    ...asArray<string>(series.tags ?? series.categories).map(cleanText)
  ]
    .filter(Boolean)
    .filter((tag, index, all) => all.indexOf(tag) === index);

  return {
    mangaId,
    mangaInfo: {
      shareUrl: `${FLAME_DOMAIN}/series/${mangaId}`,
      primaryTitle: cleanText(series.title),
      secondaryTitles: asArray<string>(series.altTitles)
        .map((secondaryTitle) => cleanText(secondaryTitle))
        .filter(Boolean),
      thumbnailUrl: seriesCoverUrl({ ...series, series_id: series.series_id ?? mangaId }),
      author: joinNames(series.author),
      artist: joinNames(series.artist),
      synopsis: cleanText(series.description),
      contentRating: "SAFE",
      status: cleanText(series.status) || "Ongoing",
      tagGroups: [
        {
          id: "genres",
          title: "Genres",
          tags: tags
            .map((tag) => ({ id: slugify(tag), title: tag }))
            .filter((tag) => tag.id)
        }
      ]
    }
  };
}

export function mapChapters(sourceManga: SourceMangaRef, payload: unknown) {
  const chapters = asArray<FlameChapterPreview>(getPageProps(payload).chapters);

  return chapters.map((chapter) => {
    const chapterNumber = Number.parseFloat(String(chapter.chapter));
    const safeChapterNumber = Number.isFinite(chapterNumber) ? chapterNumber : 0;
    const chapterTitle = cleanText(chapter.title ?? "");

    return {
      chapterId: chapterIdFor(chapter),
      sourceManga,
      langCode: "en",
      chapNum: safeChapterNumber,
      title: chapterTitle
        ? `Ch. ${formatChapterNumber(safeChapterNumber)} - ${chapterTitle}`
        : `Ch. ${formatChapterNumber(safeChapterNumber)}`,
      publishDate: new Date(Number(chapter.release_date ?? 0) * 1000),
      sortingIndex: safeChapterNumber,
      volume: 0
    };
  });
}

export function findChapterToken(chapterId: string, payload: unknown): string {
  const chapters = asArray<FlameChapterPreview>(getPageProps(payload).chapters);
  // Match on the id we handed the app, then on the token itself so that a
  // chapter list saved under either identifier keeps resolving.
  const chapter =
    chapters.find((entry) => chapterIdFor(entry) === chapterId) ??
    chapters.find((entry) => cleanText(entry.token) === chapterId);

  if (!chapter?.token) {
    throw new Error(`Unable to find token for chapter ${chapterId}`);
  }

  return chapter.token;
}

export function mapChapterDetails(
  mangaId: string,
  token: string,
  payload: unknown
) {
  const chapter = getPageProps(payload).chapter;
  if (!chapter) {
    throw new Error(`Unable to parse chapter ${token}`);
  }

  const seriesId = String(chapter.series_id ?? mangaId);
  const chapterToken = cleanText(chapter.token) || token;

  return {
    id: chapterIdFor(chapter),
    mangaId,
    pages: chapterImageNames(chapter.images).map((name) =>
      withVersion(
        seriesChapterImageUrl(seriesId, chapterToken, name),
        chapter.release_date
      )
    )
  };
}

/**
 * `browse.json` is a single prerendered document holding the whole catalogue,
 * so filtering and paging both happen here rather than on the server.
 */
export function mapSearchResults(
  query: SearchQuery,
  payload: unknown,
  page = 1,
  pageSize = SEARCH_PAGE_SIZE
) {
  const rawQuery = cleanText(query.title).toLowerCase();
  const normalizedQuery = normalizeForSearch(query.title);

  const matches = asArray<FlameSeriesPreview>(getPageProps(payload).series)
    .filter((comic) => comic.series_id != null)
    .filter((comic) => {
      if (!rawQuery) {
        return true;
      }

      const titles = [comic.title, ...asArray<string>(comic.altTitles)];
      return titles.some((title) => {
        // Punctuation-insensitive match for Latin queries, plus a plain
        // substring match so non-Latin titles stay searchable.
        if (normalizedQuery && normalizeForSearch(title).includes(normalizedQuery)) {
          return true;
        }
        return cleanText(title).toLowerCase().includes(rawQuery);
      });
    })
    .map((comic) => ({
      mangaId: String(comic.series_id),
      imageUrl: seriesCoverUrl(comic),
      title: cleanText(comic.title),
      subtitle: cleanText(comic.status),
      contentRating: "SAFE"
    }));

  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, matches.length);

  return {
    items: startIndex < matches.length ? matches.slice(startIndex, endIndex) : [],
    metadata:
      endIndex < matches.length
        ? ({ page: safePage + 1 } as SearchPageMetadata)
        : undefined
  };
}

/** `${CDN}/uploads/images/series/<id>/<cover>?<last_edit>` */
export function seriesCoverUrl(series: FlameSeriesPreview): string {
  const seriesId = series.series_id;
  const cover = cleanUrl(series.cover);
  if (seriesId == null || !cover) {
    return "";
  }

  return withVersion(
    seriesImageUrl(String(seriesId), cover),
    series.last_edit
  );
}

export function carouselImageUrl(series: FlameSeriesPreview): string {
  const image = cleanUrl(series.image);
  if (!image) {
    return "";
  }

  if (/^(https?:)?\/\//i.test(image) || image.startsWith("/")) {
    return resolveImageUrl(image, FLAME_CDN_DOMAIN);
  }

  return `${FLAME_CDN_DOMAIN}/${IMAGE_CAROUSEL_PATH}/${image}`;
}

export function seriesImageUrl(seriesId: string, imageName: string): string {
  if (/^(https?:)?\/\//i.test(imageName) || imageName.startsWith("/")) {
    return resolveImageUrl(imageName, FLAME_CDN_DOMAIN);
  }

  return `${FLAME_CDN_DOMAIN}/${IMAGE_SERIES_PATH}/${seriesId}/${imageName}`;
}

export function seriesChapterImageUrl(
  seriesId: string,
  token: string,
  imageName: string
): string {
  if (/^(https?:)?\/\//i.test(imageName) || imageName.startsWith("/")) {
    return resolveImageUrl(imageName, FLAME_CDN_DOMAIN);
  }

  return `${FLAME_CDN_DOMAIN}/${IMAGE_SERIES_PATH}/${seriesId}/${token}/${imageName}`;
}

/** Chapter images arrive as an index-keyed map, not an array. */
function chapterImageNames(images: unknown): string[] {
  if (!images || typeof images !== "object") {
    return [];
  }

  const entries = Array.isArray(images)
    ? images.map((value, index) => [String(index), value] as const)
    : Object.entries(images as Record<string, unknown>).sort(
        ([left], [right]) => Number(left) - Number(right)
      );

  return entries
    .map(([, value]) => {
      if (typeof value === "string") {
        return cleanUrl(value);
      }
      return cleanUrl((value as { name?: unknown } | null)?.name);
    })
    .filter(Boolean);
}

function chapterIdFor(chapter: FlameChapterPreview): string {
  // `chapter_id` is the historical identifier; fall back to the token so a
  // payload that drops it does not collapse every chapter onto one id.
  if (chapter.chapter_id != null && String(chapter.chapter_id) !== "") {
    return String(chapter.chapter_id);
  }

  return cleanText(chapter.token);
}

function previewSubtitle(comic: FlameSeriesPreview): string {
  return [
    comic.views != null ? `${comic.views} views` : "",
    cleanText(comic.status)
  ]
    .filter(Boolean)
    .join(" | ");
}

/** `author` and `artist` are lists on Flame, not plain strings. */
function joinNames(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => cleanText(entry)).filter(Boolean).join(", ");
  }

  return cleanText(value);
}

function getPageProps(payload: unknown): Record<string, any> {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid FlameComics payload");
  }

  const maybePageProps = (payload as { pageProps?: unknown }).pageProps;
  if (!maybePageProps || typeof maybePageProps !== "object") {
    throw new Error("FlameComics payload is missing pageProps");
  }

  return maybePageProps as Record<string, any>;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function cleanText(value: unknown): string {
  if (value == null) {
    return "";
  }

  return decodeHtmlEntities(String(value).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Like {@link cleanText} but safe for URLs, which must keep their slashes. */
function cleanUrl(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function decodeHtmlEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
    "#39": "'"
  };

  return value.replace(/&([a-zA-Z0-9#]+);/g, (match, entity) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return entities[entity] ?? match;
  });
}

function slugify(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Flame's own search strips punctuation before comparing titles. */
function normalizeForSearch(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatChapterNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return String(value).replace(/0+$/, "").replace(/\.$/, "");
}
