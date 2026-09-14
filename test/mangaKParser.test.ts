import { describe, expect, it } from "vitest";
import {
  extractMangaKNextData,
  mapMangaKChapterDetails,
  mapMangaKChapters,
  mapMangaKDiscoverSectionItems,
  mapMangaKDiscoverSections,
  mapMangaKMangaDetails,
  mapMangaKSearchResults
} from "../src/mangaKParser";

const homePayload = {
  props: {
    pageProps: {
      heroItems: [
        {
          slug: "happy-together",
          name: "Happy Together",
          cover: "https://rx.resmk.org/covers/happy.webp",
          status: "ongoing",
          displayViews: "2.8M",
          updatedAt: "2026-06-19T18:02:38.000Z"
        }
      ],
      latest: {
        items: [
          {
            slug: "spear",
            name: "Spear",
            cover: "https://rx.resmk.org/covers/spear.webp",
            status: "ongoing",
            latestChapters: [
              {
                id: "real-chapter-21",
                slug: "chapter-21",
                name: "Chapter 21",
                date: "2026-06-20T17:01:15.000Z"
              }
            ]
          }
        ]
      },
      popularItems: [
        {
          slug: "oak-tree",
          name: "Under The Oak Tree",
          cover: "https://rx.resmk.org/covers/oak.webp",
          status: "ongoing",
          displayViews: "14.1M"
        }
      ],
      trendingItems: [],
      topUpdateItems: []
    }
  }
};

const seriesPayload = {
  props: {
    pageProps: {
      initialManga: {
        id: "EDVMnVwY",
        slug: "the-immortal-genius-spearman",
        name: "The Immortal Genius Spearman",
        altName: "Immortal Spear",
        altNames: [{ name: "죽지 않는 천재 창잡이" }],
        cover: "https://rx.resmk.org/covers/spearman.webp",
        status: "Ongoing",
        summary: "<p>Damian, a <strong>Centurion</strong>.</p>",
        isAdult: false,
        authors: [{ name: "Author One" }],
        artists: [{ name: "Artist One" }],
        genres: [
          { id: "action", name: "Action", slug: "action" },
          { id: "fantasy", name: "Fantasy", slug: "fantasy" }
        ],
        chapters: [
          {
            id: "chapter-2",
            realId: "real-2",
            slug: "chapter-2",
            name: "Chapter 2",
            updatedAt: "2026-06-20T17:01:15.000Z",
            chapterNumber: 2
          },
          {
            id: "chapter-1",
            realId: "real-1",
            slug: "chapter-1",
            name: "Chapter 1",
            updatedAt: "2026-06-16T16:01:49.000Z",
            chapterNumber: 1
          }
        ]
      }
    }
  }
};

describe("MangaK parser", () => {
  it("extracts Next data from MangaK HTML", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(homePayload)}</script>`;

    expect(extractMangaKNextData(html)).toEqual(homePayload);
  });

  it("maps homepage data into Paperback discover sections", () => {
    expect(mapMangaKDiscoverSections()).toEqual([
      { id: "featured", title: "Featured", type: 2 },
      { id: "latest", title: "Recently Updated", type: 3 },
      { id: "popular", title: "Popular Updates", type: 1 },
      { id: "trending", title: "Trending", type: 1 },
      { id: "top-updates", title: "Top Updates", type: 1 }
    ]);

    expect(mapMangaKDiscoverSectionItems("latest", homePayload)).toEqual({
      items: [
        {
          type: "chapterUpdatesCarouselItem",
          mangaId: "spear",
          chapterId: "chapter-21",
          title: "Spear",
          imageUrl: "https://rx.resmk.org/covers/spear.webp",
          subtitle: "Chapter 21",
          publishDate: new Date("2026-06-20T17:01:15.000Z"),
          contentRating: "SAFE"
        }
      ],
      metadata: undefined
    });
  });

  it("maps series details into a Paperback manga object", () => {
    expect(mapMangaKMangaDetails("the-immortal-genius-spearman", seriesPayload)).toEqual({
      mangaId: "the-immortal-genius-spearman",
      mangaInfo: {
        shareUrl: "https://mangak.io/the-immortal-genius-spearman",
        primaryTitle: "The Immortal Genius Spearman",
        secondaryTitles: ["Immortal Spear", "죽지 않는 천재 창잡이"],
        thumbnailUrl: "https://rx.resmk.org/covers/spearman.webp",
        author: "Author One",
        artist: "Artist One",
        synopsis: "Damian, a Centurion.",
        contentRating: "SAFE",
        status: "Ongoing",
        tagGroups: [
          {
            id: "genres",
            title: "Genres",
            tags: [
              { id: "action", title: "Action" },
              { id: "fantasy", title: "Fantasy" }
            ]
          }
        ],
        additionalInfo: {
          seriesId: "EDVMnVwY",
          slug: "the-immortal-genius-spearman"
        }
      }
    });
  });

  it("maps chapters oldest first with slug chapter ids", () => {
    expect(
      mapMangaKChapters(
        { mangaId: "the-immortal-genius-spearman", title: "The Immortal Genius Spearman" },
        seriesPayload
      )
    ).toEqual([
      {
        chapterId: "chapter-1",
        sourceManga: {
          mangaId: "the-immortal-genius-spearman",
          title: "The Immortal Genius Spearman"
        },
        title: "Chapter 1",
        chapNum: 1,
        volume: 0,
        volumetitle: "",
        langCode: "en",
        sortingIndex: 0,
        publishDate: new Date("2026-06-16T16:01:49.000Z")
      },
      {
        chapterId: "chapter-2",
        sourceManga: {
          mangaId: "the-immortal-genius-spearman",
          title: "The Immortal Genius Spearman"
        },
        title: "Chapter 2",
        chapNum: 2,
        volume: 0,
        volumetitle: "",
        langCode: "en",
        sortingIndex: 1,
        publishDate: new Date("2026-06-20T17:01:15.000Z")
      }
    ]);
  });

  it("maps reader image URLs in page order", () => {
    const chapterPayload = {
      props: {
        pageProps: {
          initialChapter: {
            id: "real-1",
            slug: "chapter-1",
            images: [
              "https://rx.qvzri.org/r/p/path/001.webp",
              "https://rx.qvzrk.org/r/p/path/002.webp"
            ]
          },
          initialManga: {
            slug: "the-immortal-genius-spearman"
          }
        }
      }
    };

    expect(
      mapMangaKChapterDetails(
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
        "https://rx.qvzri.org/r/p/path/001.webp",
        "https://rx.qvzrk.org/r/p/path/002.webp"
      ]
    });
  });

  it("maps search results with next-page metadata", () => {
    const searchPayload = {
      props: {
        pageProps: {
          ssrItems: [
            {
              slug: "forged-immortal",
              name: "Forged Immortal",
              cover: "https://rx.resmk.org/covers/forged.webp",
              status: "ongoing",
              isAdult: true,
              displayViews: "10K"
            }
          ],
          ssrPagination: {
            page: 1,
            has_next: true
          }
        }
      }
    };

    expect(mapMangaKSearchResults(searchPayload)).toEqual({
      items: [
        {
          mangaId: "forged-immortal",
          title: "Forged Immortal",
          imageUrl: "https://rx.resmk.org/covers/forged.webp",
          subtitle: "Ongoing • 10K views",
          contentRating: "ADULT"
        }
      ],
      metadata: { page: 2 }
    });
  });
  it("keeps titles that are missing a cover instead of emptying the results", () => {
    const payload = {
      props: {
        pageProps: {
          ssrItems: [
            { slug: "no-cover", name: "No Cover", status: "ONGOING" },
            {
              slug: "with-cover",
              name: "With Cover",
              status: "ONGOING",
              cover: "https://rx.resmk.org/covers/x.webp"
            }
          ],
          ssrPagination: { page: 1, has_next: false }
        }
      }
    };

    expect(mapMangaKSearchResults(payload).items.map((item) => item.mangaId)).toEqual([
      "no-cover",
      "with-cover"
    ]);
  });

  it("resolves relative covers and unwraps the Next.js image optimizer", () => {
    const payload = {
      props: {
        pageProps: {
          ssrItems: [
            { slug: "a", name: "Relative", cover: "/covers/a.webp" },
            {
              slug: "b",
              name: "Optimized",
              cover: "/_next/image?url=https%3A%2F%2Frx.resmk.org%2Fcovers%2Fb.webp&w=384&q=75"
            },
            { slug: "c", name: "Renamed", thumbnail: "//rx.resmk.org/covers/c.webp" }
          ],
          ssrPagination: { page: 1, has_next: false }
        }
      }
    };

    expect(mapMangaKSearchResults(payload).items.map((item) => item.imageUrl)).toEqual([
      "https://mangak.io/covers/a.webp",
      "https://rx.resmk.org/covers/b.webp",
      "https://rx.resmk.org/covers/c.webp"
    ]);
  });

  it("reads search results from alternate page prop containers", () => {
    const entry = { slug: "d", name: "Found", cover: "https://rx.resmk.org/covers/d.webp" };

    for (const pageProps of [
      { items: [entry] },
      { results: [entry] },
      { data: { items: [entry] } }
    ]) {
      expect(
        mapMangaKSearchResults({ props: { pageProps } }).items.map((item) => item.mangaId)
      ).toEqual(["d"]);
    }
  });
});
