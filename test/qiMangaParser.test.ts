import { describe, expect, it } from "vitest";
import {
  mapQiChapterDetails,
  mapQiChapters,
  mapQiDiscoverSectionItems,
  mapQiDiscoverSections,
  mapQiMangaDetails,
  mapQiSearchResults,
  qiNextPage,
  qiSortForSection
} from "../src/qiMangaParser";

// Shapes mirror the live API: `/series` and `/series/search` answer with
// { data, totalPages, current }; genres carry only a name; chapters carry no
// publish-status field.
const seriesListPayload = {
  data: [
    {
      id: 1229,
      slug: "the-immortal-genius-spearman",
      title: "The Immortal Genius Spearman",
      cover: "https://media.qimanga.com/spearman.webp",
      type: "MANHWA",
      status: "ONGOING"
    },
    {
      id: 44,
      slug: "a-novel",
      title: "Some Novel",
      cover: "https://media.qimanga.com/novel.webp",
      type: "NOVEL",
      status: "ONGOING"
    }
  ],
  totalPages: 3,
  current: 1
};

const seriesPayload = {
  id: 1229,
  slug: "the-immortal-genius-spearman",
  title: "The Immortal Genius Spearman",
  alternativeTitles: "죽지 않는 천재 창잡이, Immortal Spear",
  cover: "https://media.qimanga.com/spearman.webp",
  type: "MANHWA",
  status: "ONGOING",
  author: null,
  artist: "Studio",
  description: "<p>Damian, a <strong>Centurion</strong>.</p>",
  genres: [{ name: "Action" }, { name: "Martial Arts" }]
};

describe("QiManga parser", () => {
  it("builds discover sections from the series endpoint's sort values", () => {
    expect(mapQiDiscoverSections()).toEqual([
      { id: "popular", title: "Popular", type: 1 },
      { id: "latest", title: "Latest Updates", type: 1 },
      { id: "newest", title: "New Series", type: 1 }
    ]);
    expect(qiSortForSection("popular")).toBe("popular");
    expect(qiSortForSection("newest")).toBe("newest");
    expect(qiSortForSection("unknown")).toBe("latest");
  });

  it("maps a series page into discover items, skipping novels", () => {
    expect(mapQiDiscoverSectionItems("popular", seriesListPayload)).toEqual({
      items: [
        {
          type: "simpleCarouselItem",
          mangaId: "the-immortal-genius-spearman",
          title: "The Immortal Genius Spearman",
          imageUrl: "https://media.qimanga.com/spearman.webp",
          subtitle: "Manhwa • Ongoing",
          contentRating: "SAFE"
        }
      ],
      metadata: { page: 2 }
    });
  });

  it("pages search results off totalPages and current", () => {
    expect(mapQiSearchResults(seriesListPayload, 1).metadata).toEqual({ page: 2 });
    expect(
      mapQiSearchResults({ ...seriesListPayload, current: 3 }, 3).metadata
    ).toBeUndefined();
  });

  it("maps series details and derives genre ids from the name", () => {
    expect(mapQiMangaDetails("the-immortal-genius-spearman", seriesPayload)).toEqual({
      mangaId: "the-immortal-genius-spearman",
      mangaInfo: {
        shareUrl: "https://qimanga.com/series/the-immortal-genius-spearman",
        primaryTitle: "The Immortal Genius Spearman",
        secondaryTitles: ["죽지 않는 천재 창잡이", "Immortal Spear"],
        thumbnailUrl: "https://media.qimanga.com/spearman.webp",
        artist: "Studio",
        synopsis: "Damian, a Centurion.",
        contentRating: "SAFE",
        status: "ONGOING",
        tagGroups: [
          {
            id: "genres",
            title: "Genres",
            tags: [
              { id: "action", title: "Action" },
              { id: "martial-arts", title: "Martial Arts" }
            ]
          }
        ],
        additionalInfo: {
          seriesId: "1229",
          slug: "the-immortal-genius-spearman"
        }
      }
    });
  });

  // The API has no publishStatus field; requiring one hid every chapter.
  it("keeps public chapters and only drops purchase-required ones", () => {
    const chaptersPayload = {
      data: [
        {
          slug: "chapter-2",
          number: 2,
          title: "Return",
          createdAt: "2026-06-13T04:36:57.233Z"
        },
        {
          slug: "chapter-1",
          number: 1,
          title: null,
          createdAt: "2026-06-06T08:00:26.841Z"
        },
        {
          slug: "chapter-3",
          number: 3,
          requiresPurchase: true,
          createdAt: "2026-06-20T08:00:26.841Z"
        }
      ]
    };

    const chapters = mapQiChapters({ mangaId: "spearman" }, chaptersPayload);

    expect(chapters.map((chapter) => chapter.chapterId)).toEqual([
      "chapter-1",
      "chapter-2"
    ]);
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Chapter 1",
      "Chapter 2 - Return"
    ]);
  });

  it("walks chapter pages with totalPages rather than a next cursor", () => {
    expect(qiNextPage({ totalPages: 3, current: 1 }, 1)).toBe(2);
    expect(qiNextPage({ totalPages: 3, current: 3 }, 3)).toBe(0);
    expect(qiNextPage({ totalPages: 1, current: 1 }, 1)).toBe(0);
    expect(qiNextPage({}, 1)).toBe(0);
  });

  it("maps chapter images in order", () => {
    expect(
      mapQiChapterDetails(
        { chapterId: "chapter-1", sourceManga: { mangaId: "spearman" } },
        {
          images: [
            { url: "https://media.qimanga.com/2.webp", order: 2 },
            { url: "https://media.qimanga.com/1.webp", order: 1 }
          ]
        }
      )
    ).toEqual({
      id: "chapter-1",
      mangaId: "spearman",
      pages: [
        "https://media.qimanga.com/1.webp",
        "https://media.qimanga.com/2.webp"
      ]
    });
  });

  it("explains a purchase-locked chapter instead of returning no pages", () => {
    expect(() =>
      mapQiChapterDetails(
        { chapterId: "chapter-9", sourceManga: { mangaId: "spearman" } },
        { requiresPurchase: true, totalImages: 12 }
      )
    ).toThrow(/purchase/i);
  });

  it("resolves relative covers and falls back to the numeric id", () => {
    const payload = {
      data: [
        { id: 7, title: "Id Only", cover: "/uploads/b.webp" },
        { slug: "renamed", title: "Renamed", coverUrl: "https://cdn.test/c.webp" }
      ]
    };

    expect(mapQiSearchResults(payload).items).toEqual([
      {
        mangaId: "7",
        title: "Id Only",
        imageUrl: "https://api.qimanga.com/uploads/b.webp",
        subtitle: "",
        contentRating: "SAFE"
      },
      {
        mangaId: "renamed",
        title: "Renamed",
        imageUrl: "https://cdn.test/c.webp",
        subtitle: "",
        contentRating: "SAFE"
      }
    ]);
  });
});
