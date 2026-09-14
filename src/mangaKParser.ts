import { pickImageValue, resolveImageUrl } from "./urlUtils";

export const MANGAK_DOMAIN = "https://mangak.io";

/**
 * MangaK is a Next.js app, so covers can arrive as a bare CDN URL, as a
 * site-relative path, or wrapped in the `/_next/image` optimizer.
 */
const COVER_KEYS = [
  "cover",
  "coverUrl",
  "thumbnail",
  "thumbnailUrl",
  "image",
  "imageUrl",
  "poster"
];

export const MangaKDiscoverSectionType = {
  featured: 0,
  simpleCarousel: 1,
  prominentCarousel: 2,
  chapterUpdates: 3
} as const;

export type MangaKSourceMangaRef = {
  mangaId: string;
  title?: string;
  mangaInfo?: {
    additionalInfo?: {
      slug?: string;
    };
  };
};

export type MangaKSearchQuery = {
  title?: string;
};

type MangaKTitlePreview = {
  id?: string;
  slug?: string;
  name?: string;
  altName?: string;
  altNames?: Array<{ name?: string }>;
  cover?: string;
  status?: string;
  displayViews?: string;
  updatedAt?: string;
  isAdult?: boolean;
  latestChapters?: MangaKChapterPreview[];
};

type MangaKChapterPreview = {
  id?: string;
  realId?: string;
  slug?: string;
  name?: string;
  date?: string;
  updatedAt?: string;
  updated_at?: string;
  chapterNumber?: number;
  chapter_number?: number;
};

type MangaKGenre = {
  id?: string;
  name?: string;
  slug?: string;
};

export function extractMangaKNextData(html: string): unknown {
  const scriptMatch = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/
  );
  if (!scriptMatch?.[1]) {
    throw new Error("Unable to find MangaK __NEXT_DATA__ script");
  }

  return JSON.parse(decodeHtmlEntities(scriptMatch[1]));
}

export function mapMangaKDiscoverSections() {
  return [
    { id: "featured", title: "Featured", type: MangaKDiscoverSectionType.prominentCarousel },
    { id: "latest", title: "Recently Updated", type: MangaKDiscoverSectionType.chapterUpdates },
    { id: "popular", title: "Popular Updates", type: MangaKDiscoverSectionType.simpleCarousel },
    { id: "trending", title: "Trending", type: MangaKDiscoverSectionType.simpleCarousel },
    { id: "top-updates", title: "Top Updates", type: MangaKDiscoverSectionType.simpleCarousel }
  ];
}

export function mapMangaKDiscoverSectionItems(sectionId: string, payload: unknown) {
  const pageProps = getPageProps(payload);
  let items: unknown[];

  switch (sectionId) {
    case "featured":
      items = mapProminentItems(asArray<MangaKTitlePreview>(pageProps.heroItems));
      break;
    case "latest":
      items = mapChapterUpdateItems(asArray<MangaKTitlePreview>(pageProps.latest?.items));
      break;
    case "popular":
      items = mapSimpleItems(asArray<MangaKTitlePreview>(pageProps.popularItems));
      break;
    case "trending":
      items = mapSimpleItems(asArray<MangaKTitlePreview>(pageProps.trendingItems));
      break;
    case "top-updates":
      items = mapSimpleItems(asArray<MangaKTitlePreview>(pageProps.topUpdateItems));
      break;
    default:
      items = [];
      break;
  }

  return { items, metadata: undefined };
}

export function mapMangaKMangaDetails(mangaId: string, payload: unknown) {
  const manga = asRecord(getPageProps(payload).initialManga);
  if (Object.keys(manga).length === 0) {
    throw new Error(`Unable to parse MangaK series ${mangaId}`);
  }

  const slug = cleanText(manga.slug) || mangaId;
  const authors = asArray<{ name?: string }>(manga.authors)
    .map((author) => cleanText(author.name))
    .filter(Boolean);
  const artists = asArray<{ name?: string }>(manga.artists)
    .map((artist) => cleanText(artist.name))
    .filter(Boolean);
  const genres = asArray<MangaKGenre>(manga.genres);

  return {
    mangaId,
    mangaInfo: {
      shareUrl: `${MANGAK_DOMAIN}/${slug}`,
      primaryTitle: cleanText(manga.name),
      secondaryTitles: alternativeTitles(manga),
      thumbnailUrl: mangaKCoverUrl(manga),
      ...(authors.length > 0 ? { author: authors.join(", ") } : {}),
      ...(artists.length > 0 ? { artist: artists.join(", ") } : {}),
      synopsis: cleanText(manga.summary),
      contentRating: manga.isAdult === true ? "ADULT" : "SAFE",
      status: cleanText(manga.status) || "UNKNOWN",
      tagGroups: genres.length > 0
        ? [
            {
              id: "genres",
              title: "Genres",
              tags: genres
                .map((genre) => ({
                  id: cleanText(genre.slug || genre.id),
                  title: cleanText(genre.name)
                }))
                .filter((genre) => genre.id && genre.title)
            }
          ]
        : [],
      additionalInfo: {
        seriesId: cleanText(manga.id),
        slug
      }
    }
  };
}

export function mapMangaKChapters(
  sourceManga: MangaKSourceMangaRef,
  payload: unknown
) {
  const chapters = asArray<MangaKChapterPreview>(getPageProps(payload).initialManga?.chapters);

  return chapters
    .filter((chapter) => cleanText(chapter.slug))
    .sort((left, right) => chapterNumber(left) - chapterNumber(right))
    .map((chapter, index) => ({
      chapterId: cleanText(chapter.slug),
      sourceManga,
      title: cleanText(chapter.name),
      chapNum: chapterNumber(chapter),
      volume: 0,
      volumetitle: "",
      langCode: "en",
      sortingIndex: index,
      publishDate: new Date(chapter.updatedAt ?? chapter.updated_at ?? chapter.date ?? 0)
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

export function mapMangaKSearchResults(payload: unknown) {
  const pageProps = getPageProps(payload);
  const items = mapSearchItems(
    firstArray<MangaKTitlePreview>(
      pageProps.ssrItems,
      pageProps.items,
      pageProps.results,
      asRecord(pageProps.data).items,
      pageProps.data
    )
  );
  const pagination = asRecord(pageProps.ssrPagination ?? pageProps.pagination);
  const page = Number(pagination.page ?? 1);
  const hasNextPage = pagination.has_next === true;

  return {
    items,
    metadata: hasNextPage ? { page: page + 1 } : undefined
  };
}

export function mangaKSlugFromSourceManga(sourceManga: MangaKSourceMangaRef) {
  return sourceManga.mangaInfo?.additionalInfo?.slug || sourceManga.mangaId;
}

export function mangaKCoverUrl(entry: unknown): string {
  return resolveImageUrl(pickImageValue(asRecord(entry), COVER_KEYS), MANGAK_DOMAIN);
}

function mapProminentItems(series: MangaKTitlePreview[]) {
  return series.filter(isReadableTitle).map((entry) => ({
    type: "prominentCarouselItem",
    mangaId: cleanText(entry.slug),
    title: cleanText(entry.name),
    imageUrl: mangaKCoverUrl(entry),
    subtitle: subtitle(entry),
    contentRating: entry.isAdult === true ? "ADULT" : "SAFE"
  }));
}

function mapSimpleItems(series: MangaKTitlePreview[]) {
  return series.filter(isReadableTitle).map((entry) => ({
    type: "simpleCarouselItem",
    mangaId: cleanText(entry.slug),
    title: cleanText(entry.name),
    imageUrl: mangaKCoverUrl(entry),
    subtitle: subtitle(entry),
    contentRating: entry.isAdult === true ? "ADULT" : "SAFE"
  }));
}

function mapChapterUpdateItems(series: MangaKTitlePreview[]) {
  return series.filter(isReadableTitle).flatMap((entry) => {
    const chapter = asArray<MangaKChapterPreview>(entry.latestChapters)[0];
    const chapterSlug = cleanText(chapter?.slug);
    if (!chapterSlug) {
      return [];
    }

    return [{
      type: "chapterUpdatesCarouselItem",
      mangaId: cleanText(entry.slug),
      chapterId: chapterSlug,
      title: cleanText(entry.name),
      imageUrl: mangaKCoverUrl(entry),
      subtitle: cleanText(chapter?.name),
      publishDate: new Date(chapter?.date ?? chapter?.updatedAt ?? chapter?.updated_at ?? 0),
      contentRating: entry.isAdult === true ? "ADULT" : "SAFE"
    }];
  });
}

function mapSearchItems(series: MangaKTitlePreview[]) {
  return series.filter(isReadableTitle).map((entry) => ({
    mangaId: cleanText(entry.slug),
    title: cleanText(entry.name),
    imageUrl: mangaKCoverUrl(entry),
    subtitle: subtitle(entry),
    contentRating: entry.isAdult === true ? "ADULT" : "SAFE"
  }));
}

function isReadableTitle(series: MangaKTitlePreview) {
  // A title with no usable cover still reads fine; dropping it here is what
  // turns a renamed image field into an empty search screen.
  return Boolean(cleanText(series.slug) && cleanText(series.name));
}

function subtitle(entry: MangaKTitlePreview) {
  const status = titleCase(cleanText(entry.status));
  const views = cleanText(entry.displayViews);
  return [
    status,
    views ? `${views} views` : ""
  ].filter(Boolean).join(" • ");
}

function chapterNumber(chapter: MangaKChapterPreview) {
  const numeric = Number(chapter.chapterNumber ?? chapter.chapter_number);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const fromSlug = cleanText(chapter.slug).match(/(\d+(?:[-.]\d+)?)/)?.[1];
  const parsed = Number.parseFloat((fromSlug ?? "0").replace("-", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function alternativeTitles(manga: Record<string, any>) {
  const titles = [
    cleanText(manga.altName),
    ...asArray<{ name?: string }>(manga.altNames).map((title) => cleanText(title.name))
  ].filter(Boolean);

  return [...new Set(titles)];
}

function getPageProps(payload: unknown): Record<string, any> {
  return asRecord(asRecord(asRecord(payload).props).pageProps);
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

function cleanText(value: unknown): string {
  if (value == null) {
    return "";
  }

  return decodeHtmlEntities(String(value).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
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
