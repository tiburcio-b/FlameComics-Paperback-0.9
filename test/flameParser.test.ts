import { describe, expect, it } from "vitest";
import {
  extractBuildId,
  findChapterToken,
  mapChapterDetails,
  mapChapters,
  mapDiscoverSections,
  mapMangaDetails,
  mapSearchResults
} from "../src/flameParser";

const homePayload = {
  pageProps: {
    carousel: [
      { series_id: 2, title: "Omniscient Reader", image: "carousel.webp" }
    ],
    popularEntries: {
      blocks: [
        {
          series: [
            {
              series_id: 154,
              title: "Sword Clan",
              views: 592,
              status: "Ongoing",
              cover: "thumbnail.webp",
              last_edit: 1781623014
            }
          ]
        }
      ]
    },
    latestEntries: {
      blocks: [
        {
          series: [
            {
              series_id: 160,
              title: "Moonlight",
              status: "Ongoing",
              cover: "thumbnail.webp",
              last_edit: 1781623015
            }
          ]
        }
      ]
    }
  }
};

const seriesPayload = {
  pageProps: {
    series: {
      series_id: 154,
      title: "Sword Clan",
      altTitles: ["<b>Alt Sword</b>"],
      cover: "thumbnail.webp",
      last_edit: 1781623014,
      type: "Manhwa",
      artist: ["Artist One", "Artist Two"],
      author: ["Author One"],
      description: "<p>A <strong>clean</strong> synopsis.</p>",
      status: "Ongoing",
      tags: ["Action", "Fantasy"]
    },
    chapters: [
      {
        chapter_id: 10,
        chapter: "2.00",
        title: "Return",
        release_date: 1781623014,
        token: "chapter-token"
      },
      {
        chapter_id: 9,
        chapter: "1.00",
        title: "",
        release_date: 1781016067,
        token: "chapter-token-1"
      }
    ]
  }
};

describe("Flame parser", () => {
  it("extracts the Next.js build id from homepage HTML", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"buildId":"abc123"}</script>`;

    expect(extractBuildId(html)).toBe("abc123");
  });

  it("maps homepage payload into 0.9 discover sections", () => {
    const sections = mapDiscoverSections(homePayload);

    expect(sections).toEqual([
      {
        id: "featured",
        title: "Featured",
        type: 0,
        items: [
          {
            type: "featuredCarouselItem",
            mangaId: "2",
            imageUrl: "https://cdn.flamecomics.xyz/uploads/images/carousel/carousel.webp",
            title: "Omniscient Reader"
          }
        ]
      },
      {
        id: "popular",
        title: "Popular",
        type: 1,
        items: [
          {
            type: "simpleCarouselItem",
            mangaId: "154",
            imageUrl:
              "https://cdn.flamecomics.xyz/uploads/images/series/154/thumbnail.webp?1781623014",
            title: "Sword Clan",
            subtitle: "592 views | Ongoing"
          }
        ]
      },
      {
        id: "latest",
        title: "Latest",
        type: 1,
        items: [
          {
            type: "simpleCarouselItem",
            mangaId: "160",
            imageUrl:
              "https://cdn.flamecomics.xyz/uploads/images/series/160/thumbnail.webp?1781623015",
            title: "Moonlight",
            subtitle: "Ongoing"
          }
        ]
      }
    ]);
  });

  it("maps manga details into a 0.9 source manga", () => {
    expect(mapMangaDetails("154", seriesPayload)).toEqual({
      mangaId: "154",
      mangaInfo: {
        shareUrl: "https://flamecomics.xyz/series/154",
        primaryTitle: "Sword Clan",
        secondaryTitles: ["Alt Sword"],
        thumbnailUrl:
          "https://cdn.flamecomics.xyz/uploads/images/series/154/thumbnail.webp?1781623014",
        author: "Author One",
        artist: "Artist One, Artist Two",
        synopsis: "A clean synopsis.",
        contentRating: "SAFE",
        status: "Ongoing",
        tagGroups: [
          {
            id: "genres",
            title: "Genres",
            tags: [
              { id: "manhwa", title: "Manhwa" },
              { id: "action", title: "Action" },
              { id: "fantasy", title: "Fantasy" }
            ]
          }
        ]
      }
    });
  });

  it("maps chapters with stable ids and source manga references", () => {
    expect(mapChapters({ mangaId: "154", title: "Sword Clan" }, seriesPayload)).toEqual([
      {
        chapterId: "10",
        sourceManga: { mangaId: "154", title: "Sword Clan" },
        langCode: "en",
        chapNum: 2,
        title: "Ch. 2 - Return",
        publishDate: new Date(1781623014 * 1000),
        sortingIndex: 2,
        volume: 0
      },
      {
        chapterId: "9",
        sourceManga: { mangaId: "154", title: "Sword Clan" },
        langCode: "en",
        chapNum: 1,
        title: "Ch. 1",
        publishDate: new Date(1781016067 * 1000),
        sortingIndex: 1,
        volume: 0
      }
    ]);
  });

  it("maps chapter page image names to CDN URLs", () => {
    const chapterPayload = {
      pageProps: {
        chapter: {
          chapter_id: 10,
          series_id: 154,
          token: "chapter-token",
          release_date: 1781623014,
          images: {
            0: { name: "001.webp" },
            1: { name: "002.webp" }
          }
        }
      }
    };

    expect(mapChapterDetails("154", "chapter-token", chapterPayload)).toEqual({
      id: "10",
      mangaId: "154",
      pages: [
        "https://cdn.flamecomics.xyz/uploads/images/series/154/chapter-token/001.webp?1781623014",
        "https://cdn.flamecomics.xyz/uploads/images/series/154/chapter-token/002.webp?1781623014"
      ]
    });
  });

  it("maps search results and filters by title", () => {
    const browsePayload = {
      pageProps: {
        series: [
          {
            series_id: 1,
            title: "Solo Leveling",
            status: "Completed",
            cover: "thumbnail.webp",
            last_edit: 1781623014
          },
          {
            series_id: 2,
            title: "Other Series",
            status: "Ongoing",
            cover: "thumbnail.png",
            last_edit: 1781623015
          }
        ]
      }
    };

    expect(mapSearchResults({ title: "solo" }, browsePayload)).toEqual({
      items: [
        {
          mangaId: "1",
          imageUrl:
            "https://cdn.flamecomics.xyz/uploads/images/series/1/thumbnail.webp?1781623014",
          title: "Solo Leveling",
          subtitle: "Completed",
          contentRating: "SAFE"
        }
      ],
      metadata: undefined
    });
  });
  it("matches alternative titles and pages search results", () => {
    const browsePayload = {
      pageProps: {
        series: Array.from({ length: 25 }, (_, index) => ({
          series_id: index + 1,
          title: `Series ${index + 1}`,
          altTitles: index === 24 ? ["Solo: Leveling!"] : [],
          status: "Ongoing",
          cover: "thumbnail.webp",
          last_edit: 1
        }))
      }
    };

    // Punctuation is stripped on both sides before comparing, as the site does.
    const byAltTitle = mapSearchResults({ title: "solo leveling" }, browsePayload);
    expect(byAltTitle.items.map((item) => item.mangaId)).toEqual(["25"]);

    const firstPage = mapSearchResults({ title: "" }, browsePayload);
    expect(firstPage.items).toHaveLength(20);
    expect(firstPage.metadata).toEqual({ page: 2 });

    const secondPage = mapSearchResults({ title: "" }, browsePayload, 2);
    expect(secondPage.items).toHaveLength(5);
    expect(secondPage.metadata).toBeUndefined();
  });

  it("keeps series that are missing a cover instead of dropping them", () => {
    const browsePayload = {
      pageProps: {
        series: [{ series_id: 7, title: "No Cover", status: "Ongoing" }]
      }
    };

    expect(mapSearchResults({ title: "no cover" }, browsePayload).items).toEqual([
      {
        mangaId: "7",
        imageUrl: "",
        title: "No Cover",
        subtitle: "Ongoing",
        contentRating: "SAFE"
      }
    ]);
  });

  it("falls back to the chapter token when chapter_id is absent", () => {
    const payload = {
      pageProps: {
        chapters: [
          { chapter: "3.00", release_date: 1, token: "tok-3" },
          { chapter_id: 9, chapter: "1.00", release_date: 1, token: "tok-1" }
        ]
      }
    };

    expect(mapChapters({ mangaId: "154" }, payload).map((c) => c.chapterId)).toEqual([
      "tok-3",
      "9"
    ]);
    expect(findChapterToken("tok-3", payload)).toBe("tok-3");
    expect(findChapterToken("9", payload)).toBe("tok-1");
    // A chapter list saved under the old token-based id still resolves.
    expect(findChapterToken("tok-1", payload)).toBe("tok-1");
  });

  it("orders chapter pages by their numeric image key", () => {
    const chapterPayload = {
      pageProps: {
        chapter: {
          chapter_id: 10,
          series_id: 154,
          token: "chapter-token",
          release_date: 5,
          images: {
            10: { name: "011.webp" },
            2: { name: "003.webp" },
            1: { name: "002.webp" }
          }
        }
      }
    };

    expect(mapChapterDetails("154", "chapter-token", chapterPayload).pages).toEqual([
      "https://cdn.flamecomics.xyz/uploads/images/series/154/chapter-token/002.webp?5",
      "https://cdn.flamecomics.xyz/uploads/images/series/154/chapter-token/003.webp?5",
      "https://cdn.flamecomics.xyz/uploads/images/series/154/chapter-token/011.webp?5"
    ]);
  });
  it("still matches titles that normalisation would strip to nothing", () => {
    const browsePayload = {
      pageProps: {
        series: [
          {
            series_id: 3,
            title: "나 혼자만 레벨업",
            status: "Ongoing",
            cover: "thumbnail.webp",
            last_edit: 1
          }
        ]
      }
    };

    expect(
      mapSearchResults({ title: "레벨업" }, browsePayload).items.map((i) => i.mangaId)
    ).toEqual(["3"]);
  });
});
