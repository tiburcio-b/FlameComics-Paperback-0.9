import { describe, expect, it } from "vitest";
import {
  extractMangaKNextData,
  mangaKSortForSection,
  mapMangaKChapterDetails,
  mapMangaKChapters,
  mapMangaKDiscoverSectionItems,
  mapMangaKDiscoverSections,
  mapMangaKMangaDetails,
  mapMangaKSearchResults,
  normalizePath
} from "../src/mangaKParser";

// `/titles/search` shape: { data: { items, pagination: { has_next } } }
const searchPayload = {
  data: {
    items: [
      {
        id: "63a1f",
        name: "The Immortal Spearman",
        cover: "https://rx.qvzra.org/covers/spear.webp",
        url: "/the-immortal-spearman"
      },
      {
        id: "77b2c",
        name: "Oak Tree",
        cover: "https://rx.qvzra.org/covers/oak.webp",
        url: "https://mangak.io/oak-tree"
      }
    ],
    pagination: { has_next: true }
  }
};

// `/titles/{id}/chapters` shape: { data: { chapters: [...] } }
const chapterListPayload = {
  data: {
    chapters: [
      {
        url: "/the-immortal-spearman/chapter-2",
        name: "Chapter 2",
        updated_at: "2026-06-13T04:36:57.233Z",
        chapter_number: 2
      },
      {
        url: "/the-immortal-spearman/chapter-1",
        name: "Chapter 1",
        updated_at: "2026-06-06T08:00:26.841Z",
        chapter_number: 1
      }
    ]
  }
};

const detailsPayload = {
  props: {
    pageProps: {
      initialManga: {
        id: "63a1f",
        name: "The Immortal Spearman",
        summary: "<p>A <strong>spear</strong>.</p>",
        cover: "https://rx.qvzra.org/covers/spear.webp",
        status: "ONGOING",
        authors: [{ name: "Author One" }],
        genres: [{ name: "Action" }, { name: "Martial Arts" }]
      }
    }
  }
};

describe("MangaK parser", () => {
  it("builds discover sections from the search endpoint", () => {
    expect(mapMangaKDiscoverSections()).toEqual([
      { id: "popular", title: "Popular This Week", type: 1 },
      { id: "latest", title: "Latest Updates", type: 1 }
    ]);
    expect(mangaKSortForSection("popular")).toMatchObject({
      sort: "popular",
      window: "week"
    });
    expect(mangaKSortForSection("anything-else")).toMatchObject({ sort: "latest" });
  });

  it("normalises ids to a site-relative path", () => {
    expect(normalizePath("https://mangak.io/oak-tree")).toBe("oak-tree");
    expect(normalizePath("/oak-tree/")).toBe("oak-tree");
    expect(normalizePath("oak-tree")).toBe("oak-tree");
    expect(normalizePath(undefined)).toBe("");
  });

  it("maps search results and pages off has_next", () => {
    expect(mapMangaKSearchResults(searchPayload, 1)).toEqual({
      items: [
        {
          mangaId: "the-immortal-spearman",
          title: "The Immortal Spearman",
          imageUrl: "https://rx.qvzra.org/covers/spear.webp",
          contentRating: "SAFE"
        },
        {
          mangaId: "oak-tree",
          title: "Oak Tree",
          imageUrl: "https://rx.qvzra.org/covers/oak.webp",
          contentRating: "SAFE"
        }
      ],
      metadata: { page: 2 }
    });

    const lastPage = { data: { items: [], pagination: { has_next: false } } };
    expect(mapMangaKSearchResults(lastPage, 4).metadata).toBeUndefined();
  });

  it("maps discover items from the same payload", () => {
    const { items } = mapMangaKDiscoverSectionItems("popular", searchPayload);
    expect(items[0]).toEqual({
      type: "simpleCarouselItem",
      mangaId: "the-immortal-spearman",
      title: "The Immortal Spearman",
      imageUrl: "https://rx.qvzra.org/covers/spear.webp",
      contentRating: "SAFE"
    });
  });

  it("maps details and keeps the API id needed for the chapter list", () => {
    const details = mapMangaKMangaDetails("the-immortal-spearman", detailsPayload);

    expect(details.mangaInfo.primaryTitle).toBe("The Immortal Spearman");
    expect(details.mangaInfo.synopsis).toBe("A spear.");
    expect(details.mangaInfo.author).toBe("Author One");
    expect(details.mangaInfo.thumbnailUrl).toBe(
      "https://rx.qvzra.org/covers/spear.webp"
    );
    expect(details.mangaInfo.additionalInfo).toEqual({
      seriesId: "63a1f",
      slug: "the-immortal-spearman"
    });
    expect(details.mangaInfo.tagGroups[0].tags).toEqual([
      { id: "action", title: "Action" },
      { id: "martial-arts", title: "Martial Arts" }
    ]);
  });

  it("reads chapters from the chapters API, oldest first", () => {
    const chapters = mapMangaKChapters(
      { mangaId: "the-immortal-spearman" },
      chapterListPayload
    );

    expect(chapters.map((chapter) => chapter.chapterId)).toEqual([
      "the-immortal-spearman/chapter-1",
      "the-immortal-spearman/chapter-2"
    ]);
    expect(chapters.map((chapter) => chapter.chapNum)).toEqual([1, 2]);
    expect(chapters[0].publishDate).toEqual(new Date("2026-06-06T08:00:26.841Z"));
  });

  it("maps chapter pages from the embedded page payload", () => {
    const payload = {
      props: {
        pageProps: {
          initialChapter: {
            images: [
              "https://rx.qvzra.org/1.webp",
              "/relative/2.webp"
            ]
          }
        }
      }
    };

    expect(
      mapMangaKChapterDetails(
        {
          chapterId: "the-immortal-spearman/chapter-1",
          sourceManga: { mangaId: "the-immortal-spearman" }
        },
        payload
      ).pages
    ).toEqual([
      "https://rx.qvzra.org/1.webp",
      "https://mangak.io/relative/2.webp"
    ]);
  });

  it("extracts page data from __NEXT_DATA__", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialManga":{"id":"1","name":"X"}}}}</script>`;

    expect(mapMangaKMangaDetails("x", extractMangaKNextData(html)).mangaInfo.primaryTitle)
      .toBe("X");
  });

  it("finds page data when it is not in a __NEXT_DATA__ script", () => {
    const html = `<script>self.__next_f.push([1,"{\\"pageProps\\":{\\"initialManga\\":{\\"id\\":\\"2\\",\\"name\\":\\"Y\\"}}}"])</script>`;

    expect(mapMangaKMangaDetails("y", extractMangaKNextData(html)).mangaInfo.primaryTitle)
      .toBe("Y");
  });

  it("throws a clear error when no page data is present", () => {
    expect(() => extractMangaKNextData("<html><body>nope</body></html>")).toThrow(
      /Unable to find MangaK page data/
    );
  });
});
