import { describe, expect, it } from "vitest";
import {
  mapQiChapterDetails,
  mapQiChapters,
  mapQiDiscoverSectionItems,
  mapQiDiscoverSections,
  mapQiMangaDetails,
  mapQiSearchResults
} from "../src/qiMangaParser";

const homePayload = {
  banners: [
    {
      slug: "warrior-grandpa-and-supreme-granddaughter",
      title: "Warrior Grandpa and Supreme Granddaughter",
      cover: "https://media.qimanhwa.com/cover.webp",
      type: "MANHWA",
      status: "ONGOING",
      redirectUrl: null
    }
  ],
  popular: [
    {
      slug: "evolution-from-a-tree",
      title: "Evolution From a Tree",
      cover: "https://media.qimanga.com/tree.webp",
      type: "MANHUA",
      status: "ONGOING",
      redirectUrl: "",
      chapters: [
        {
          slug: "chapter-521",
          number: 521,
          price: 75,
          createdAt: "2026-06-13T04:36:57.233Z"
        },
        {
          slug: "chapter-520",
          number: 520,
          price: 0,
          createdAt: "2026-06-06T08:00:26.841Z"
        }
      ]
    }
  ],
  pinned: [],
  newSeries: [],
  editorsPick: [
    {
      slug: "warrior-grandpa-and-supreme-granddaughter",
      title: "Warrior Grandpa and Supreme Granddaughter",
      cover: "https://media.qimanhwa.com/cover.webp",
      type: "MANHWA",
      status: "ONGOING",
      redirectUrl: null
    }
  ]
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
  genres: [
    { id: 2, name: "Action", slug: "action" },
    { id: 9, name: " Fantasy ", slug: "fantasy" }
  ]
};

describe("QiManga parser", () => {
  it("maps the homepage payload into discover sections using numeric 0.9 section types", () => {
    expect(mapQiDiscoverSections()).toEqual([
      { id: "featured", title: "Featured", type: 2 },
      { id: "popular", title: "Popular Today", type: 3 },
      { id: "pinned", title: "Pinned", type: 3 },
      { id: "new", title: "New Series", type: 3 },
      { id: "editors-pick", title: "Editor's Pick", type: 1 }
    ]);
  });

  it("maps discover section items and skips paid update chapters", () => {
    expect(mapQiDiscoverSectionItems("popular", homePayload)).toEqual({
      items: [
        {
          type: "chapterUpdatesCarouselItem",
          mangaId: "evolution-from-a-tree",
          chapterId: "chapter-520",
          title: "Evolution From a Tree",
          imageUrl: "https://media.qimanga.com/tree.webp",
          subtitle: "Ch. 520",
          publishDate: new Date("2026-06-06T08:00:26.841Z"),
          contentRating: "SAFE"
        }
      ],
      metadata: undefined
    });
  });

  it("maps series details into a Paperback manga object", () => {
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
              { id: "2", title: "Action" },
              { id: "9", title: "Fantasy" }
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

  it("maps public free chapters and filters locked chapters", () => {
    const chaptersPayload = {
      data: [
        {
          slug: "chapter-2",
          number: 2,
          title: "Return",
          price: 50,
          requiresPurchase: true,
          publishStatus: "PUBLIC",
          createdAt: "2026-06-13T16:56:29.624Z"
        },
        {
          slug: "chapter-1",
          number: 1,
          title: null,
          price: 0,
          requiresPurchase: false,
          publishStatus: "PUBLIC",
          createdAt: "2026-06-06T16:56:29.624Z"
        },
        {
          slug: "draft",
          number: 0,
          title: "Draft",
          price: 0,
          requiresPurchase: false,
          publishStatus: "DRAFT",
          createdAt: "2026-06-01T16:56:29.624Z"
        }
      ]
    };

    expect(
      mapQiChapters(
        { mangaId: "the-immortal-genius-spearman", title: "The Immortal Genius Spearman" },
        chaptersPayload
      )
    ).toEqual([
      {
        chapterId: "chapter-1",
        sourceManga: {
          mangaId: "the-immortal-genius-spearman",
          title: "The Immortal Genius Spearman"
        },
        title: "",
        chapNum: 1,
        volume: 0,
        volumetitle: "",
        langCode: "en",
        sortingIndex: 0,
        publishDate: new Date("2026-06-06T16:56:29.624Z")
      }
    ]);
  });

  it("maps chapter image URLs in page order", () => {
    const chapterPayload = {
      images: [
        { url: "https://media.qimanga.com/02.webp", order: 2 },
        { url: "https://media.qimanga.com/01.webp", order: 1 }
      ]
    };

    expect(
      mapQiChapterDetails(
        {
          chapterId: "chapter-1",
          sourceManga: { mangaId: "the-immortal-genius-spearman" }
        },
        chapterPayload
      )
    ).toEqual({
      id: "chapter-1",
      mangaId: "the-immortal-genius-spearman",
      pages: [
        "https://media.qimanga.com/01.webp",
        "https://media.qimanga.com/02.webp"
      ]
    });
  });

  it("maps search results and removes novels or redirect-only entries", () => {
    const searchPayload = {
      data: [
        {
          slug: "forged-immortal",
          title: "Forged Immortal",
          cover: "https://media.qimanga.com/forged.webp",
          type: "MANHUA",
          status: "DROPPED",
          redirectUrl: ""
        },
        {
          slug: "external-entry",
          title: "External Entry",
          cover: "https://media.qimanga.com/external.webp",
          type: "MANHWA",
          status: "ONGOING",
          redirectUrl: "https://example.com"
        },
        {
          slug: "novel-entry",
          title: "Novel Entry",
          cover: "https://media.qimanga.com/novel.webp",
          type: "NOVEL",
          status: "ONGOING",
          redirectUrl: ""
        }
      ]
    };

    expect(mapQiSearchResults(searchPayload)).toEqual({
      items: [
        {
          mangaId: "forged-immortal",
          title: "Forged Immortal",
          imageUrl: "https://media.qimanga.com/forged.webp",
          subtitle: "Manhua • Dropped",
          contentRating: "SAFE"
        }
      ],
      metadata: undefined
    });
  });
  it("resolves relative covers and reads renamed cover fields", () => {
    const payload = {
      data: [
        { slug: "a", title: "Absolute", cover: "https://media.qimanga.com/a.webp" },
        { slug: "b", title: "Relative", cover: "/uploads/b.webp" },
        { slug: "c", title: "Renamed", coverUrl: "/uploads/c.webp" },
        { slug: "d", title: "Wrapped", cover: { url: "/uploads/d.webp" } }
      ]
    };

    expect(mapQiSearchResults(payload).items.map((item) => item.imageUrl)).toEqual([
      "https://media.qimanga.com/a.webp",
      "https://api.qimanga.com/uploads/b.webp",
      "https://api.qimanga.com/uploads/c.webp",
      "https://api.qimanga.com/uploads/d.webp"
    ]);
  });

  it("keeps a series that has no cover at all", () => {
    const payload = { data: [{ slug: "e", title: "No Cover" }] };

    expect(mapQiSearchResults(payload).items).toEqual([
      {
        mangaId: "e",
        title: "No Cover",
        imageUrl: "",
        subtitle: "",
        contentRating: "SAFE"
      }
    ]);
  });

  it("reads search results from alternate response containers", () => {
    const entry = { slug: "f", title: "Found", cover: "https://media.qimanga.com/f.webp" };

    for (const payload of [
      { results: [entry] },
      { items: [entry] },
      { series: [entry] },
      [entry]
    ]) {
      expect(mapQiSearchResults(payload).items.map((item) => item.mangaId)).toEqual(["f"]);
    }
  });

  it("falls back to the numeric id when a series has no slug", () => {
    const payload = { data: [{ id: 1229, title: "Id Only" }] };

    expect(mapQiSearchResults(payload).items[0].mangaId).toBe("1229");
  });
});
