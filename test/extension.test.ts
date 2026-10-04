import { afterEach, describe, expect, it } from "vitest";
import { FlameComicsExtension } from "../src/extension";

const textEncoder = new TextEncoder();

function bytes(value: string): ArrayBuffer {
  return textEncoder.encode(value).buffer as ArrayBuffer;
}

function installFakeApplication(routes: Record<string, { status?: number; body: string }>) {
  const calls: string[] = [];
  const state = new Map<string, unknown>();

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
    getState(key: string) {
      return state.get(key);
    },
    setState(value: unknown, key: string) {
      state.set(key, value);
    },
    registerInterceptor() {},
    Selector(target: unknown, selector: string) {
      return `${String((target as any)?.constructor?.name ?? "target")}.${selector}`;
    }
  } as any;

  return { calls, state };
}

afterEach(() => {
  delete (globalThis as any).Application;
});

describe("FlameComics extension runtime", () => {
  it("refreshes build id and retries section requests when cached build id is stale", async () => {
    const routes = {
      "https://flamecomics.xyz": {
        body: `<script id="__NEXT_DATA__">{"buildId":"fresh"}</script>`
      },
      "https://flamecomics.xyz/_next/data/stale/index.json": {
        status: 404,
        body: ""
      },
      "https://flamecomics.xyz/_next/data/fresh/index.json": {
        body: JSON.stringify({
          pageProps: {
            carousel: [],
            popularEntries: { blocks: [{ series: [] }] },
            latestEntries: { blocks: [{ series: [] }] }
          }
        })
      }
    };
    const { calls, state } = installFakeApplication(routes);
    state.set("buildId", "stale");

    const extension = new FlameComicsExtension();
    const result = await extension.getDiscoverSectionItems(
      { id: "featured", title: "Featured", type: "featured" },
      undefined
    );

    expect(result).toEqual({ items: [], metadata: undefined });
    expect(calls).toEqual([
      "https://flamecomics.xyz/_next/data/stale/index.json",
      "https://flamecomics.xyz",
      "https://flamecomics.xyz/_next/data/fresh/index.json"
    ]);
    expect(state.get("buildId")).toBe("fresh");
  });

  it("treats an HTML answer from a stale build id like a 404 and retries", async () => {
    const htmlPage = `<!DOCTYPE html><html><head><title>Flame Comics</title></head></html>`;
    const series = [{ series_id: 1, title: "Omniscient Reader", cover: "c.webp" }];
    const routes = {
      "https://flamecomics.xyz": {
        body: `<script id="__NEXT_DATA__">{"buildId":"fresh"}</script>`
      },
      "https://flamecomics.xyz/_next/data/stale/browse.json": { body: htmlPage },
      "https://flamecomics.xyz/_next/data/fresh/browse.json": {
        body: JSON.stringify({ pageProps: { series } })
      }
    };
    const { calls, state } = installFakeApplication(routes);
    state.set("buildId", "stale");

    const extension = new FlameComicsExtension();
    const result = await extension.getSearchResults({ title: "omniscient" }, undefined);

    expect(result.items.map((item) => item.mangaId)).toEqual(["1"]);
    expect(calls).toEqual([
      "https://flamecomics.xyz/_next/data/stale/browse.json",
      "https://flamecomics.xyz",
      "https://flamecomics.xyz/_next/data/fresh/browse.json"
    ]);
    expect(state.get("buildId")).toBe("fresh");
  });

  it("falls back to the server-rendered page when data routes keep answering HTML", async () => {
    const htmlPage = `<!DOCTYPE html><html><head><title>Flame Comics</title></head></html>`;
    const series = [{ series_id: 1, title: "Omniscient Reader", cover: "c.webp" }];
    const browsePage = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      buildId: "fresh",
      props: { pageProps: { series } }
    })}</script></html>`;
    const routes = {
      "https://flamecomics.xyz": {
        body: `<script id="__NEXT_DATA__">{"buildId":"fresh"}</script>`
      },
      "https://flamecomics.xyz/_next/data/fresh/browse.json": { body: htmlPage },
      "https://flamecomics.xyz/browse": { body: browsePage }
    };
    const { calls } = installFakeApplication(routes);

    const extension = new FlameComicsExtension();
    const first = await extension.getSearchResults({ title: "omniscient" }, undefined);
    expect(first.items.map((item) => item.mangaId)).toEqual(["1"]);
    // The build id was read fresh, so there is nothing to retry with.
    expect(calls).toEqual([
      "https://flamecomics.xyz",
      "https://flamecomics.xyz/_next/data/fresh/browse.json",
      "https://flamecomics.xyz/browse"
    ]);

    // Later calls in the session skip straight to the page.
    calls.length = 0;
    await extension.getSearchResults({ title: "omniscient" }, undefined);
    expect(calls).toEqual(["https://flamecomics.xyz/browse"]);
  });

  it("raises a Cloudflare bypass for a challenge page instead of a JSON error", async () => {
    const challenge = `<!DOCTYPE html><html><head><title>Just a moment...</title></head>
      <body><script>window._cf_chl_opt={cvId: '3'};</script></body></html>`;
    installFakeApplication({
      "https://flamecomics.xyz": { status: 403, body: challenge }
    });

    const extension = new FlameComicsExtension();
    await expect(
      extension.getSearchResults({ title: "omniscient" }, undefined)
    ).rejects.toMatchObject({
      type: "cloudflareError",
      resolutionRequest: { url: "https://flamecomics.xyz", method: "GET" }
    });
  });

  it("names the page it got when the site answers with something unexpected", async () => {
    installFakeApplication({
      "https://flamecomics.xyz": {
        body: `<html><head><title>Site Maintenance</title></head></html>`
      }
    });

    const extension = new FlameComicsExtension();
    await expect(
      extension.getSearchResults({ title: "omniscient" }, undefined)
    ).rejects.toThrow(/Site Maintenance/);
  });

  it("marks data-route requests the way the site's own router does", async () => {
    installFakeApplication({});
    const extension = new FlameComicsExtension();

    const request = await extension.interceptRequest({
      url: "https://flamecomics.xyz/_next/data/fresh/browse.json",
      method: "GET"
    });

    expect(request.headers).toMatchObject({ "x-nextjs-data": "1" });
  });

  it("builds chapter details URLs from the chapter token in series JSON", async () => {
    const routes = {
      "https://flamecomics.xyz": {
        body: `<script id="__NEXT_DATA__">{"buildId":"fresh"}</script>`
      },
      "https://flamecomics.xyz/_next/data/fresh/series/154.json?id=154": {
        body: JSON.stringify({
          pageProps: {
            series: { title: "Sword Clan", cover: "thumbnail.webp", tags: [] },
            chapters: [{ chapter_id: 10, chapter: "1.00", token: "abc" }]
          }
        })
      },
      "https://flamecomics.xyz/_next/data/fresh/series/154/abc.json?id=154&token=abc": {
        body: JSON.stringify({
          pageProps: {
            chapter: { chapter_id: 10, images: { 0: { name: "001.webp" } } }
          }
        })
      }
    };
    const { calls } = installFakeApplication(routes);

    const extension = new FlameComicsExtension();
    const result = await extension.getChapterDetails({
      chapterId: "10",
      sourceManga: { mangaId: "154" }
    });

    expect(result.pages).toEqual([
      "https://cdn.flamecomics.xyz/uploads/images/series/154/abc/001.webp"
    ]);
    expect(calls).toContain(
      "https://flamecomics.xyz/_next/data/fresh/series/154/abc.json?id=154&token=abc"
    );
  });

  it("throws a Cloudflare bypass error when a challenge response is detected", async () => {
    installFakeApplication({});
    const extension = new FlameComicsExtension();

    await expect(
      extension.interceptResponse(
        { url: "https://flamecomics.xyz", method: "GET" },
        { status: 403, headers: { "cf-mitigated": "challenge" } },
        bytes("")
      )
    ).rejects.toMatchObject({
      type: "cloudflareError",
      resolutionRequest: {
        url: "https://flamecomics.xyz",
        method: "GET"
      }
    });
  });
  it("requests the plain browse document for search and pages through it", async () => {
    const series = Array.from({ length: 22 }, (_, index) => ({
      series_id: index + 1,
      title: `Series ${index + 1}`,
      status: "Ongoing",
      cover: "thumbnail.webp",
      last_edit: 7
    }));
    const routes = {
      "https://flamecomics.xyz": {
        body: `<script id="__NEXT_DATA__">{"buildId":"fresh"}</script>`
      },
      "https://flamecomics.xyz/_next/data/fresh/browse.json": {
        body: JSON.stringify({ pageProps: { series } })
      }
    };
    const { calls } = installFakeApplication(routes);

    const extension = new FlameComicsExtension();
    const first = await extension.getSearchResults({ title: "series" }, undefined);

    // No `search` query param: the data route is a prerendered document and an
    // unexpected param risks a 404 that would surface as a failed search.
    expect(calls).toContain("https://flamecomics.xyz/_next/data/fresh/browse.json");
    expect(
      calls.some((url) => url.includes("browse.json?"))
    ).toBe(false);
    expect(first.items).toHaveLength(20);
    expect(first.metadata).toEqual({ page: 2 });

    const second = await extension.getSearchResults({ title: "series" }, { page: 2 });
    expect(second.items).toHaveLength(2);
    expect(second.metadata).toBeUndefined();
  });

  it("sends a referer and user agent without a malformed origin header", async () => {
    installFakeApplication({});
    const extension = new FlameComicsExtension();

    const request = await extension.interceptRequest({
      url: "https://cdn.flamecomics.xyz/uploads/images/series/154/thumbnail.webp",
      method: "GET"
    });

    expect(request.headers).toEqual({
      referer: "https://flamecomics.xyz/",
      "user-agent": "Paperback-Test"
    });
    expect(request.headers).not.toHaveProperty("origin");
  });
});
