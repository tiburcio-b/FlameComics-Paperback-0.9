import { pickImageValue, resolveImageUrl } from "./urlUtils";

export const MANGAK_DOMAIN = "https://mangak.io";
export const MANGAK_API_DOMAIN = "https://api.mangak.io";
export const MANGAK_PAGE_SIZE = 24;
/** The search endpoint rejects long or punctuated queries. */
export const MANGAK_QUERY_LIMIT = 50;

export const MangaKDiscoverSectionType = {
  featured: 0,
  simpleCarousel: 1,
  prominentCarousel: 2,
  chapterUpdates: 3
} as const;

/**
 * Discover is built from `/titles/search`, the endpoint the site's own client
 * uses. The previous homepage-scraping sections no longer exist in the page
 * payload.
 */
export const MANGAK_DISCOVER_SECTIONS = [
  { id: "popular", title: "Popular This Week", sort: "popular", window: "week" },
  { id: "latest", title: "Latest Updates", sort: "latest", window: "" }
] as const;

export type MangaKSourceMangaRef = {
  mangaId: string;
  title?: string;
  mangaInfo?: {
    additionalInfo?: {
      seriesId?: string;
      slug?: string;
    };
  };
};

export type MangaKSearchQuery = {
  title?: string;
};

export type MangaKPageMetadata = {
  page: number;
};

type MangaKItem = {
  id?: string;
  name?: string;
  cover?: string;
  url?: string;
};

type MangaKChapterItem = {
  url?: string;
  name?: string;
  updated_at?: string;
  updatedAt?: string;
  chapter_number?: number;
  chapterNumber?: number;
};

/**
 * Pull the Next.js page payload out of a server-rendered document.
 *
 * The series and chapter pages still embed `pageProps`; the id of the script
 * carrying it has moved before, so fall back to locating the object directly.
 */
export function extractMangaKNextData(html: string): unknown {
  const scriptMatch = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/
  );

  if (scriptMatch?.[1]) {
    try {
      return JSON.parse(decodeHtmlEntities(scriptMatch[1]));
    } catch {
      // fall through to the scan below
    }
  }

  const scanned = scanForPageProps(html);
  if (scanned) {
    return scanned;
  }

  throw new Error("Unable to find MangaK page data");
}

export function mapMangaKDiscoverSections() {
  return MANGAK_DISCOVER_SECTIONS.map(({ id, title }) => ({
    id,
    title,
    type: MangaKDiscoverSectionType.simpleCarousel
  }));
}

export function mangaKSortForSection(sectionId: string) {
  return (
    MANGAK_DISCOVER_SECTIONS.find((section) => section.id === sectionId) ??
    MANGAK_DISCOVER_SECTIONS[1]
  );
}

export function mapMangaKDiscoverSectionItems(
  _sectionId: string,
  payload: unknown,
  page = 1
) {
  const { items, metadata } = readTitlesPage(payload, page);

  return {
    items: items.map((entry) => ({
      type: "simpleCarouselItem",
      mangaId: mangaKMangaId(entry),
      title: cleanText(entry.name),
      imageUrl: mangaKCoverUrl(entry),
      contentRating: "SAFE"
    })),
    metadata
  };
}

export function mapMangaKSearchResults(payload: unknown, page = 1) {
  const { items, metadata } = readTitlesPage(payload, page);

  return {
    items: items.map((entry) => ({
      mangaId: mangaKMangaId(entry),
      title: cleanText(entry.name),
      imageUrl: mangaKCoverUrl(entry),
      contentRating: "SAFE"
    })),
    metadata
  };
}

export function mapMangaKMangaDetails(mangaId: string, payload: unknown) {
  const manga = asRecord(getPageProps(payload).initialManga);
  if (Object.keys(manga).length === 0) {
    throw new Error(`Unable to parse MangaK series ${mangaId}`);
  }

  const authors = entityNames(manga.authors);
  const artists = entityNames(manga.artists);
  const genres = entityNames(manga.genres).map((name) => ({
    id: slugify(name),
    title: name
  }));
  const seriesId = cleanText(manga.id);

  return {
    mangaId,
    mangaInfo: {
      shareUrl: `${MANGAK_DOMAIN}/${mangaId}`,
      primaryTitle: cleanText(manga.name),
      secondaryTitles: alternativeTitles(manga),
      thumbnailUrl: mangaKCoverUrl(manga),
      ...(authors.length > 0 ? { author: authors.join(", ") } : {}),
      ...(artists.length > 0 ? { artist: artists.join(", ") } : {}),
      synopsis: cleanText(manga.summary),
      contentRating: manga.isAdult === true ? "ADULT" : "SAFE",
      status: cleanText(manga.status) || "UNKNOWN",
      tagGroups: genres.length > 0
        ? [{ id: "genres", title: "Genres", tags: genres }]
        : [],
      additionalInfo: {
        // The chapter list is keyed by this API id, not by the page slug.
        seriesId,
        slug: mangaId
      }
    }
  };
}

/** Reads `/titles/{id}/chapters`, which replaced the in-page chapter list. */
export function mapMangaKChapters(
  sourceManga: MangaKSourceMangaRef,
  payload: unknown
) {
  const result = asRecord(payload);
  const chapters = firstArray<MangaKChapterItem>(
    asRecord(result.data).chapters,
    result.chapters,
    result.data
  );

  return chapters
    .filter((chapter) => mangaKChapterId(chapter))
    .sort((left, right) => chapterNumber(left) - chapterNumber(right))
    .map((chapter, index) => ({
      chapterId: mangaKChapterId(chapter),
      sourceManga,
      title: cleanText(chapter.name),
      chapNum: chapterNumber(chapter),
      volume: 0,
      langCode: "en",
      sortingIndex: index,
      publishDate: new Date(chapter.updated_at ?? chapter.updatedAt ?? 0)
    }));
}

export function mapMangaKChapterDetails(
  chapter: { chapterId: string; sourceManga: MangaKSourceMangaRef },
  payload: unknown
) {
  const pages = asArray<unknown>(getPageProps(payload).initialChapter?.images)
    .map((page) =>
      resolveImageUrl(
        typeof page === "string"
          ? page
          : pickImageValue(asRecord(page), ["url", "src", "image", "path"]),
        MANGAK_DOMAIN
      )
    )
    .filter(Boolean);

  if (pages.length === 0) {
    throw new Error("No chapter page data could be parsed from MangaK for this chapter.");
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages
  };
}

/** `{ data: { items: [...], pagination: { has_next } } }` */
export function readTitlesPage(payload: unknown, page = 1) {
  const result = asRecord(payload);
  const data = asRecord(result.data);
  const items = firstArray<MangaKItem>(
    data.items,
    result.items,
    result.results,
    Array.isArray(result.data) ? result.data : undefined
  ).filter((entry) => mangaKMangaId(entry) && cleanText(entry.name));

  const pagination = asRecord(data.pagination ?? result.pagination);
  const hasNext = pagination.has_next === true || pagination.hasNext === true;
  const currentPage = Number.isFinite(Number(page)) && Number(page) > 0
    ? Math.floor(Number(page))
    : 1;

  return {
    items,
    metadata: hasNext ? ({ page: currentPage + 1 } as MangaKPageMetadata) : undefined
  };
}

export function mangaKSeriesIdFromSourceManga(sourceManga: MangaKSourceMangaRef) {
  return cleanText(sourceManga.mangaInfo?.additionalInfo?.seriesId);
}

export function mangaKSlugFromSourceManga(sourceManga: MangaKSourceMangaRef) {
  return sourceManga.mangaInfo?.additionalInfo?.slug || sourceManga.mangaId;
}

export function mangaKCoverUrl(entry: unknown): string {
  const value = pickImageValue(asRecord(entry), [
    "cover",
    "coverUrl",
    "thumbnail",
    "thumbnailUrl",
    "image",
    "imageUrl",
    "poster"
  ]);

  return resolveImageUrl(value, MANGAK_DOMAIN);
}

/** Site-relative path used both as the id and to build the page URL. */
export function mangaKMangaId(entry: MangaKItem): string {
  return normalizePath(entry.url) || cleanText(entry.id);
}

export function mangaKChapterId(chapter: MangaKChapterItem): string {
  return normalizePath(chapter.url);
}

export function normalizePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "";
  }

  return raw
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function chapterNumber(chapter: MangaKChapterItem): number {
  const numeric = Number(chapter.chapter_number ?? chapter.chapterNumber);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const fromSlug = mangaKChapterId(chapter).match(/(\d+(?:[-.]\d+)?)\s*$/)?.[1];
  const parsed = Number.parseFloat((fromSlug ?? "0").replace("-", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function entityNames(value: unknown): string[] {
  return asArray<unknown>(value)
    .map((entry) =>
      typeof entry === "string" ? cleanText(entry) : cleanText(asRecord(entry).name)
    )
    .filter(Boolean);
}

function alternativeTitles(manga: Record<string, any>) {
  const titles = [
    cleanText(manga.altName),
    ...entityNames(manga.altNames)
  ].filter(Boolean);

  return [...new Set(titles)];
}

/**
 * Locate the JSON object holding `pageProps` when it is not in a script we can
 * address by id, including payloads embedded as escaped JS strings.
 */
function scanForPageProps(html: string): unknown {
  for (const candidate of [html, html.replace(/\\"/g, '"')]) {
    let index = candidate.indexOf('"pageProps"');

    while (index !== -1) {
      const start = candidate.lastIndexOf("{", index);
      if (start !== -1) {
        const parsed = parseObjectAt(candidate, start);
        if (parsed && asRecord(parsed).pageProps) {
          return parsed;
        }
      }
      index = candidate.indexOf('"pageProps"', index + 1);
    }
  }

  return undefined;
}

function parseObjectAt(text: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}

function getPageProps(payload: unknown): Record<string, any> {
  const root = asRecord(payload);
  const nested = asRecord(asRecord(root.props).pageProps);
  if (Object.keys(nested).length > 0) {
    return nested;
  }

  return asRecord(root.pageProps);
}

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as Record<string, any>;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function firstArray<T>(...candidates: unknown[]): T[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as T[];
    }
  }

  return [];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanText(value: unknown): string {
  if (value == null) {
    return "";
  }

  return decodeHtmlEntities(String(value).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function decodeHtmlEntities(value: string) {
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
