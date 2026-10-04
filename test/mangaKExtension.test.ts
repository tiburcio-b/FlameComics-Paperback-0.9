import { afterEach, describe, expect, it } from "vitest";
import { MangaKExtension } from "../src/mangaKExtension";

const textEncoder = new TextEncoder();

function bytes(value: string): ArrayBuffer {
  return textEncoder.encode(value).buffer as ArrayBuffer;
}

type FakeResponse = { status?: number; body: string };

function installFakeApplication(routes: Record<string, FakeResponse>) {
  return installFakeApplicationMatching((url) => routes[url]);
}

/** For URLs that carry a cache-busting parameter and cannot be matched exactly. */
function installFakeApplicationMatching(
  resolve: (url: string) => FakeResponse | undefined
) {
  const calls: string[] = [];

  globalThis.Application = {
    async scheduleRequest(request: { url: string }) {
      calls.push(request.url);
      const response = resolve(request.url);
      if (!response) {
        return [{ status: 404, headers: {}, cookies: [] }, bytes("")];
      }

      return [
        { status: response.status ?? 200, headers: {}, cookies: [] },
        bytes(response.body)
      ];
    },
    arrayBufferToUTF8String(buffer: ArrayBuffer) {
      return new TextDecoder().decode(buffer);
    },
    async getDefaultUserAgent() {
      return "Paperback-Test";
    },
    getState() {
      return undefined;
    },
    setState() {},
    registerInterceptor() {},
    Selector(target: unknown, selector: string) {
      return `${String((target as any)?.constructor?.name ?? "target")}.${selector}`;
    }
  } as any;

  return { calls };
}

afterEach(() => {
  delete (globalThis as any).Application;
});

describe("MangaK extension runtime", () => {
  it("reads details from the page and chapters from the chapters API", async () => {
    const detailsHtml = `<script id="__NEXT_DATA__">${JSON.stringify({
      props: {
        pageProps: {
          initialManga: {
            id: "63a1f",
            name: "The Immortal Spearman",
            cover: "https://rx.qvzra.org/covers/spear.webp",
            status: "ONGOING"
          }
        }
      }
    })}</script>`;

    const routes: Record<string, { body: string }> = {
      "https://mangak.io/the-immortal-spearman": { body: detailsHtml }
    };
    const { calls } = installFakeApplication(routes);

    const extension = new MangaKExtension();
    const details = await extension.getMangaDetails("the-immortal-spearman");

    expect(details.mangaInfo.additionalInfo.seriesId).toBe("63a1f");
    expect(calls).toEqual(["https://mangak.io/the-immortal-spearman"]);
  });

  it("uses the stored series id for the chapter list instead of refetching", async () => {
    const chapterPayload = JSON.stringify({
      data: {
        chapters: [
          {
            url: "/the-immortal-spearman/chapter-1",
            name: "Chapter 1",
            chapter_number: 1,
            updated_at: "2026-06-01T00:00:00.000Z"
          }
        ]
      }
    });

    // The chapter-list URL carries a cache-busting timestamp, so match on prefix.
    const { calls } = installFakeApplicationMatching((url) =>
      url.startsWith("https://api.mangak.io/titles/63a1f/chapters?cv=")
        ? { body: chapterPayload }
        : undefined
    );

    const extension = new MangaKExtension();
    const chapters = await extension.getChapters({
      mangaId: "the-immortal-spearman",
      mangaInfo: { additionalInfo: { seriesId: "63a1f" } }
    });

    expect(chapters.map((chapter) => chapter.chapterId)).toEqual([
      "the-immortal-spearman/chapter-1"
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/titles/63a1f/chapters?cv=");
  });

  it("strips punctuation from the search query and pages off has_next", async () => {
    const url =
      "https://api.mangak.io/titles/search?page=1&limit=24&q=immortal+spearman";
    const { calls } = installFakeApplication({
      [url]: {
        body: JSON.stringify({
          data: {
            items: [
              {
                id: "1",
                name: "The Immortal Spearman",
                cover: "https://rx.qvzra.org/c.webp",
                url: "/the-immortal-spearman"
              }
            ],
            pagination: { has_next: true }
          }
        })
      }
    });

    const extension = new MangaKExtension();
    const results = await extension.getSearchResults(
      { title: "immortal, spearman!" },
      undefined
    );

    expect(calls).toEqual([url]);
    expect(results.items[0].mangaId).toBe("the-immortal-spearman");
    expect(results.metadata).toEqual({ page: 2 });
  });

  it("builds search and discover URLs without URLSearchParams, which the app lacks", async () => {
    const searchUrl = "https://api.mangak.io/titles/search?page=1&limit=24&q=solo";
    const discoverUrl =
      "https://api.mangak.io/titles/search?sort=latest&page=1&limit=24";
    const empty = {
      body: JSON.stringify({ data: { items: [], pagination: { has_next: false } } })
    };
    const { calls } = installFakeApplication({ [searchUrl]: empty, [discoverUrl]: empty });

    const original = globalThis.URLSearchParams;
    delete (globalThis as any).URLSearchParams;
    try {
      const extension = new MangaKExtension();
      await extension.getSearchResults({ title: "solo" }, undefined);
      await extension.getDiscoverSectionItems(
        { id: "latest", title: "Latest Updates", type: 1 },
        undefined
      );
    } finally {
      globalThis.URLSearchParams = original;
    }

    expect(calls).toEqual([searchUrl, discoverUrl]);
  });

  it("encodes apostrophes in ids and requests the original path", async () => {
    const searchUrl = "https://api.mangak.io/titles/search?page=1&limit=24&q=dan";
    const detailsHtml = `<script id="__NEXT_DATA__">${JSON.stringify({
      props: { pageProps: { initialManga: { id: "9", name: "Dan's Story" } } }
    })}</script>`;
    const { calls } = installFakeApplication({
      [searchUrl]: {
        body: JSON.stringify({
          data: {
            items: [{ id: "9", name: "Dan's Story", url: "/dan's-story" }],
            pagination: { has_next: false }
          }
        })
      },
      "https://mangak.io/dan's-story": { body: detailsHtml }
    });

    const extension = new MangaKExtension();
    const results = await extension.getSearchResults({ title: "dan" }, undefined);
    const mangaId = results.items[0].mangaId;

    expect(mangaId).toBe("dan%27s-story");
    const details = await extension.getMangaDetails(mangaId);
    expect(details.mangaInfo.primaryTitle).toBe("Dan's Story");
    expect(calls).toEqual([searchUrl, "https://mangak.io/dan's-story"]);
  });

  it("requests discover items with the section's sort and window", async () => {
    const url =
      "https://api.mangak.io/titles/search?sort=popular&page=1&limit=24&window=week";
    const { calls } = installFakeApplication({
      [url]: {
        body: JSON.stringify({ data: { items: [], pagination: { has_next: false } } })
      }
    });

    const extension = new MangaKExtension();
    await extension.getDiscoverSectionItems(
      { id: "popular", title: "Popular This Week", type: 1 },
      undefined
    );

    expect(calls).toEqual([url]);
  });

  it("throws a Cloudflare bypass error when a challenge response is detected", async () => {
    installFakeApplication({});
    const extension = new MangaKExtension();

    await expect(
      extension.interceptResponse(
        { url: "https://mangak.io/home", method: "GET" },
        { status: 403, headers: { "cf-mitigated": "challenge" } } as any,
        bytes("")
      )
    ).rejects.toMatchObject({ type: "cloudflareError" });
  });
});
