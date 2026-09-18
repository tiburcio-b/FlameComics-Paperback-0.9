import { pickImageValue, resolveImageUrl } from "./urlUtils";

export const QIMANGA_DOMAIN = "https://qimanga.com";
export const QIMANGA_API_DOMAIN = "https://api.qimanga.com/api";
export const QIMANGA_API_ORIGIN = "https://api.qimanga.com";
export const QIMANGA_PAGE_SIZE = 20;
export const QIMANGA_CHAPTER_PAGE_SIZE = 100;

export const QiDiscoverSectionType = {
  featured: 0,
  simpleCarousel: 1,
  prominentCarousel: 2,
  chapterUpdates: 3
} as const;

/**
 * Sort values the `/series` endpoint accepts. Discover is built from this
 * endpoint rather than `/home`: it is the one the site's own clients use, it
 * paginates, and it returns the same series shape as search.
 */
export const QI_DISCOVER_SECTIONS = [
  { id: "popular", title: "Popular", sort: "popular" },
  { id: "latest", title: "Latest Updates", sort: "latest" },
  { id: "newest", title: "New Series", sort: "newest" }
] as const;

export type QiSourceMangaRef = {
  mangaId: string;
  title?: string;
  mangaInfo?: {
    additionalInfo?: {
      slug?: string;
    };
  };
};

export type QiSearchQuery = {
  title?: string;
};

export type QiPageMetadata = {
  page: number;
};

type QiSeriesPreview = {
  id?: number | string;
  slug?: string;
  title?: string;
  cover?: string;
  type?: string;
  status?: string;
  redirectUrl?: string | null;
};

type QiChapterPreview = {
  slug?: string;
  number?: number;
  title?: string | null;
  price?: number;
  requiresPurchase?: boolean;
  createdAt?: string;
};

type QiGenre = {
  id?: number | string;
  name?: string;
  slug?: string;
};

export function mapQiDiscoverSections() {
  return QI_DISCOVER_SECTIONS.map(({ id, title }) => ({
    id,
    title,
    type: QiDiscoverSectionType.simpleCarousel
  }));
}

export function qiSortForSection(sectionId: string): string {
  return (
    QI_DISCOVER_SECTIONS.find((section) => section.id === sectionId)?.sort ??
    "latest"
  );
}

export function mapQiDiscoverSectionItems(
  _sectionId: string,
  payload: unknown,
  page = 1
) {
  const { series, metadata } = readSeriesPage(payload, page);

  return {
    items: series.map((entry) => ({
      type: "simpleCarouselItem",
      mangaId: qiMangaId(entry),
      title: cleanText(entry.title),
      imageUrl: qiCoverUrl(entry),
      subtitle: metadataSubtitle(entry.type, entry.status),
      contentRating: "SAFE"
    })),
    metadata
  };
}

export function mapQiMangaDetails(mangaId: string, payload: unknown) {
  const series = asRecord(payload);
  const slug = cleanText(series.slug) || mangaId;
  const title = cleanText(series.title);
  const author = cleanText(series.author);
  const artist = cleanText(series.artist);
  // Genres carry only a name on this API; derive a stable id from it.
  const genres = asArray<QiGenre>(series.genres)
    .map((genre) => {
      const genreTitle = cleanText(genre.name);
      return {
        id: cleanText(genre.slug) || cleanText(genre.id) || slugify(genreTitle),
        title: genreTitle
      };
    })
    .filter((genre) => genre.id && genre.title);

  return {
    mangaId,
    mangaInfo: {
      shareUrl: `${QIMANGA_DOMAIN}/series/${slug}`,
      primaryTitle: title,
      secondaryTitles: splitAlternativeTitles(series.alternativeTitles),
      thumbnailUrl: qiCoverUrl(series),
      ...(author ? { author } : {}),
      ...(artist ? { artist } : {}),
      synopsis: cleanText(series.description),
      contentRating: "SAFE",
      status: cleanText(series.status) || "UNKNOWN",
      tagGroups: genres.length > 0
        ? [{ id: "genres", title: "Genres", tags: genres }]
        : [],
      additionalInfo: {
        seriesId: cleanText(series.id),
        slug
      }
    }
  };
}

export function mapQiChapters(sourceManga: QiSourceMangaRef, payload: unknown) {
  const chapters = asArray<QiChapterPreview>(
    firstArray(asRecord(payload).data, asRecord(payload).chapters)
  );

  return chapters
    .filter(isReadableChapter)
    .sort((left, right) => (left.number ?? 0) - (right.number ?? 0))
    .map((chapter, index) => ({
      chapterId: cleanText(chapter.slug),
      sourceManga,
      title: chapterTitle(chapter),
      chapNum: chapter.number ?? 0,
      volume: 0,
      langCode: "en",
      sortingIndex: index,
      publishDate: new Date(chapter.createdAt ?? 0)
    }));
}

export function mapQiChapterDetails(
  chapter: { chapterId: string; sourceManga: QiSourceMangaRef },
  payload: unknown
) {
  const result = asRecord(payload);

  if (result.requiresPurchase === true) {
    throw new Error(
      "This QiManga chapter requires a purchase, so its pages are not publicly readable."
    );
  }

  const pages = firstArray(result.images, result.pages, asRecord(result.data).images)
    .map((image, index) => ({ image, order: pageOrder(image, index) }))
    .sort((left, right) => left.order - right.order)
    .map(({ image }) =>
      resolveImageUrl(
        typeof image === "string"
          ? image
          : pickImageValue(asRecord(image), ["url", "src", "image", "path"]),
        QIMANGA_API_ORIGIN
      )
    )
    .filter(Boolean);

  if (pages.length === 0) {
    throw new Error("No chapter page data could be parsed from QiManga for this chapter.");
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages
  };
}

export function mapQiSearchResults(payload: unknown, page = 1) {
  const { series, metadata } = readSeriesPage(payload, page);

  return {
    items: series.map((entry) => ({
      mangaId: qiMangaId(entry),
      title: cleanText(entry.title),
      imageUrl: qiCoverUrl(entry),
      subtitle: metadataSubtitle(entry.type, entry.status),
      contentRating: "SAFE"
    })),
    metadata
  };
}

/**
 * `/series` and `/series/search` both answer with
 * `{ data: [...], totalPages, current }`.
 */
export function readSeriesPage(payload: unknown, page = 1) {
  const result = Array.isArray(payload) ? { data: payload } : asRecord(payload);
  const data = firstArray<QiSeriesPreview>(
    result.data,
    result.results,
    result.items,
    result.series
  ).filter(isReadableSeries);

  const currentPage = toPositiveInt(result.current) || toPositiveInt(page) || 1;
  const totalPages = toPositiveInt(result.totalPages);

  return {
    series: data,
    metadata:
      totalPages > currentPage
        ? ({ page: currentPage + 1 } as QiPageMetadata)
        : undefined
  };
}

/** How many chapter pages remain after the one just read. */
export function qiNextPage(payload: unknown, currentPage: number): number {
  const result = asRecord(payload);
  const current = toPositiveInt(result.current) || currentPage;
  const totalPages = toPositiveInt(result.totalPages);

  return totalPages > current ? current + 1 : 0;
}

export function qiSlugFromSourceManga(sourceManga: QiSourceMangaRef) {
  return sourceManga.mangaInfo?.additionalInfo?.slug || sourceManga.mangaId;
}

export function qiCoverUrl(entry: unknown): string {
  const value = pickImageValue(asRecord(entry), [
    "cover",
    "coverUrl",
    "coverImage",
    "thumbnail",
    "thumbnailUrl",
    "image",
    "imageUrl",
    "poster"
  ]);

  return resolveImageUrl(value, QIMANGA_API_ORIGIN);
}

/** Series are addressed by slug, with the numeric id as a fallback. */
export function qiMangaId(entry: QiSeriesPreview): string {
  return cleanText(entry.slug) || cleanText(entry.id);
}

function chapterTitle(chapter: QiChapterPreview): string {
  const number = chapter.number;
  const numberText =
    number == null ? "" : Number.isInteger(number) ? String(number) : String(number);
  const title = cleanText(chapter.title);

  if (!numberText) {
    return title || "Chapter";
  }
  if (!title || title === numberText) {
    return `Chapter ${numberText}`;
  }
  if (title.includes(numberText) && /^(chapter|ch\.?|episode|ep\.?)\b/i.test(title)) {
    return title;
  }

  return `Chapter ${numberText} - ${title}`;
}

function isReadableSeries(series: QiSeriesPreview) {
  const title = cleanText(series.title);
  return Boolean(
    title &&
    qiMangaId(series) &&
    !title.startsWith("http://") &&
    !title.startsWith("https://") &&
    series.type !== "NOVEL" &&
    !cleanText(series.redirectUrl)
  );
}

/**
 * Chapters are public unless they are behind a coin purchase. There is no
 * publish-status field on this API; requiring one hid every chapter.
 */
function isReadableChapter(chapter: QiChapterPreview) {
  return Boolean(
    cleanText(chapter.slug) &&
    chapter.requiresPurchase !== true &&
    Number(chapter.price ?? 0) === 0
  );
}

function splitAlternativeTitles(value: unknown) {
  return cleanText(value)
    .split(/, ?/)
    .map((title) => title.trim())
    .filter(Boolean);
}

function metadataSubtitle(type: unknown, status: unknown) {
  return [type, status]
    .map((value) => cleanText(value).toLowerCase().replace(/_/g, " "))
    .filter(Boolean)
    .map((value) => value.replace(/\b\w/g, (char) => char.toUpperCase()))
    .join(" • ");
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

/** First of the candidates that is actually an array. */
function firstArray<T>(...candidates: unknown[]): T[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as T[];
    }
  }

  return [];
}

function pageOrder(image: unknown, index: number): number {
  const order = asRecord(image).order;
  return typeof order === "number" && Number.isFinite(order) ? order : index;
}

function toPositiveInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
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
