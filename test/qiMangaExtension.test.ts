import { afterEach, describe, expect, it } from "vitest";
import { QiMangaExtension } from "../src/qiMangaExtension";

const textEncoder = new TextEncoder();

function bytes(value: string): ArrayBuffer {
  return textEncoder.encode(value).buffer as ArrayBuffer;
}

function installFakeApplication(routes: Record<string, { status?: number; body: string }>) {
  const calls: string[] = [];

  globalThis.Application = {
    async scheduleRequest(request: { url: string }) {
      calls.push(request.url);
      const response = routes[request.url];
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

describe("QiManga extension runtime", () => {
  it("walks every chapter page using totalPages and keeps public chapters", async () => {
    const chapterUrl = (page: number) =>
      `https://api.qimanga.com/api/v1/series/sample/chapters?page=${page}&perPage=100&sort=desc`;

    const routes = {
      [chapterUrl(1)]: {
        body: JSON.stringify({
          totalPages: 2,
          current: 1,
          data: [
            { slug: "chapter-2", number: 2, createdAt: "2026-06-02T00:00:00.000Z" },
            {
              slug: "chapter-3",
              number: 3,
              requiresPurchase: true,
              createdAt: "2026-06-03T00:00:00.000Z"
            }
          ]
        })
      },
      [chapterUrl(2)]: {
        body: JSON.stringify({
          totalPages: 2,
          current: 2,
          data: [
            { slug: "chapter-1", number: 1, createdAt: "2026-06-01T00:00:00.000Z" }
          ]
        })
      }
    };
    const { calls } = installFakeApplication(routes);

    const extension = new QiMangaExtension();
    const chapters = await extension.getChapters({ mangaId: "sample" });

    expect(calls).toEqual([chapterUrl(1), chapterUrl(2)]);
    expect(chapters.map((chapter) => chapter.chapterId)).toEqual([
      "chapter-1",
      "chapter-2"
    ]);
  });

  it("searches the series endpoint and browses it when the query is empty", async () => {
    const searchUrl =
      "https://api.qimanga.com/api/v1/series/search?q=immortal&page=1&perPage=20";
    const browseUrl =
      "https://api.qimanga.com/api/v1/series?page=1&perPage=20&sort=latest";
    const payload = JSON.stringify({
      totalPages: 1,
      current: 1,
      data: [{ slug: "a", title: "A", cover: "https://cdn.test/a.webp" }]
    });
    const { calls } = installFakeApplication({
      [searchUrl]: { body: payload },
      [browseUrl]: { body: payload }
    });

    const extension = new QiMangaExtension();
    await extension.getSearchResults({ title: "immortal" }, undefined);
    await extension.getSearchResults({ title: "  " }, undefined);

    expect(calls).toEqual([searchUrl, browseUrl]);
  });

  it("requests discover items with the section's sort value", async () => {
    const url =
      "https://api.qimanga.com/api/v1/series?page=1&perPage=20&sort=popular";
    const { calls } = installFakeApplication({
      [url]: {
        body: JSON.stringify({ totalPages: 1, current: 1, data: [] })
      }
    });

    const extension = new QiMangaExtension();
    await extension.getDiscoverSectionItems(
      { id: "popular", title: "Popular", type: 1 },
      undefined
    );

    expect(calls).toEqual([url]);
  });

  it("sends the API fetch headers on data calls but not on images", async () => {
    installFakeApplication({});
    const extension = new QiMangaExtension();

    const apiRequest = await extension.interceptRequest({
      url: "https://api.qimanga.com/api/v1/home",
      method: "GET"
    });
    expect(apiRequest.headers).toMatchObject({
      accept: "application/json, text/plain, */*",
      origin: "https://qimanga.com",
      "sec-fetch-mode": "cors"
    });

    const imageRequest = await extension.interceptRequest({
      url: "https://media.qimanga.com/cover.webp",
      method: "GET"
    });
    expect(imageRequest.headers).not.toHaveProperty("origin");
    expect(imageRequest.headers).toMatchObject({ referer: "https://qimanga.com/" });
  });

  it("hands the app valid ids for slugs with apostrophes and requests them unencoded", async () => {
    const slug = "the-dan-family's-good-for-nothing-is-too-strong";
    const searchUrl =
      "https://api.qimanga.com/api/v1/series/search?q=dan&page=1&perPage=20";
    const routes = {
      [searchUrl]: {
        body: JSON.stringify({
          totalPages: 1,
          current: 1,
          data: [{ id: 7, slug, title: "The Dan Family's Good-for-Nothing" }]
        })
      },
      [`https://api.qimanga.com/api/v1/series/${slug}`]: {
        body: JSON.stringify({ id: 7, slug, title: "The Dan Family's Good-for-Nothing" })
      },
      [`https://api.qimanga.com/api/v1/series/${slug}/chapters?page=1&perPage=100&sort=desc`]: {
        body: JSON.stringify({
          totalPages: 1,
          current: 1,
          data: [{ slug: "chapter-1", number: 1, createdAt: "2026-06-01T00:00:00.000Z" }]
        })
      }
    };
    const { calls } = installFakeApplication(routes);

    const extension = new QiMangaExtension();
    const results = await extension.getSearchResults({ title: "dan" }, undefined);
    const mangaId = results.items[0].mangaId;

    expect(mangaId).toMatch(/^[A-Za-z0-9._\-@()[\]%?#+=/&:]+$/);

    const details = await extension.getMangaDetails(mangaId);
    expect(details.mangaInfo.additionalInfo.slug).toBe(slug);

    const chapters = await extension.getChapters({ mangaId });
    expect(chapters).toHaveLength(1);
    expect(calls).toEqual([
      searchUrl,
      `https://api.qimanga.com/api/v1/series/${slug}`,
      `https://api.qimanga.com/api/v1/series/${slug}/chapters?page=1&perPage=100&sort=desc`
    ]);
  });

  it("throws a Cloudflare bypass error when a challenge response is detected", async () => {
    installFakeApplication({});
    const extension = new QiMangaExtension();

    await expect(
      extension.interceptResponse(
        { url: "https://api.qimanga.com/api/v1/home", method: "GET" },
        { status: 403, headers: { "cf-mitigated": "challenge" } } as any,
        bytes("")
      )
    ).rejects.toMatchObject({ type: "cloudflareError" });
  });
});
