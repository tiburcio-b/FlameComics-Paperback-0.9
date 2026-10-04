import {
  FLAME_DOMAIN,
  describeHtml,
  extractNextData,
  isCloudflareChallenge,
  parseNextDataPayload,
  findChapterToken,
  mapChapterDetails,
  mapChapters,
  mapDiscoverSectionItems,
  mapDiscoverSectionList,
  mapMangaDetails,
  mapSearchResults,
  type SearchPageMetadata,
  type SearchQuery,
  type SourceMangaRef
} from "./flameParser";
import {
  BasicRateLimiter,
  CloudflareError,
  CookieStorageInterceptor,
  PaperbackInterceptor,
  type Cookie,
  type Request,
  type Response
} from "@paperback/types";

const BUILD_ID_STATE_KEY = "buildId";

type FetchedPage = {
  request: Request;
  status: number;
  headers: Record<string, string>;
  body: string;
};

type DiscoverSection = {
  id: string;
  title: string;
  type: string;
};

type ChapterRef = {
  chapterId: string;
  sourceManga: SourceMangaRef;
};

class FlameComicsInterceptor extends PaperbackInterceptor {
  async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...(request.headers ?? {}),
        referer: `${FLAME_DOMAIN}/`,
        "user-agent": await Application.getDefaultUserAgent(),
        // The site's own router sends this on every data-route fetch.
        ...(request.url.includes("/_next/data/") ? { "x-nextjs-data": "1" } : {})
      }
    };
  }

  async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer
  ): Promise<ArrayBuffer> {
    if (headerValue(response.headers, "cf-mitigated") === "challenge") {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent()
        }
      });
    }

    return data;
  }
}

export class FlameComicsExtension {
  private buildId = "";
  /**
   * Set once a data route still fails with a freshly read build id; from then
   * on this session reads the server-rendered pages directly.
   */
  private dataRoutesUnavailable = false;
  private cookieStorageInterceptor?: CookieStorageInterceptor;
  private globalRateLimiter = new BasicRateLimiter("flamecomics-rate-limiter", {
    numberOfRequests: 2,
    bufferInterval: 2,
    ignoreImages: true
  });
  private flameComicsInterceptor = new FlameComicsInterceptor("flamecomics");

  async initialise() {
    this.globalRateLimiter.registerInterceptor();
    this.cookies().registerInterceptor();
    this.flameComicsInterceptor.registerInterceptor();
  }

  async interceptRequest(request: Request): Promise<Request> {
    return this.flameComicsInterceptor.interceptRequest(request);
  }

  async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer
  ): Promise<ArrayBuffer> {
    return this.flameComicsInterceptor.interceptResponse(request, response, data);
  }

  async getDiscoverSections() {
    const payload = await this.fetchNextData("index.json", "");
    return mapDiscoverSectionList(payload);
  }

  async getDiscoverSectionItems(section: DiscoverSection, _metadata?: unknown) {
    const payload = await this.fetchNextData("index.json", "");
    return mapDiscoverSectionItems(section.id, payload);
  }

  async getMangaDetails(mangaId: string) {
    const payload = await this.fetchSeriesPayload(mangaId);
    return mapMangaDetails(mangaId, payload);
  }

  async getChapters(sourceManga: SourceMangaRef) {
    const payload = await this.fetchSeriesPayload(sourceManga.mangaId);
    return mapChapters(sourceManga, payload);
  }

  async getChapterDetails(chapter: ChapterRef) {
    const mangaId = chapter.sourceManga.mangaId;
    const seriesPayload = await this.fetchSeriesPayload(mangaId);
    const token = findChapterToken(chapter.chapterId, seriesPayload);
    const chapterPayload = await this.fetchNextData(
      `series/${mangaId}/${encodeURIComponent(token)}.json?id=${encodeURIComponent(mangaId)}&token=${encodeURIComponent(token)}`,
      `series/${encodeURIComponent(mangaId)}/${encodeURIComponent(token)}`
    );

    return mapChapterDetails(mangaId, token, chapterPayload);
  }

  async getSearchResults(query: SearchQuery, metadata?: SearchPageMetadata) {
    const payload = await this.fetchNextData("browse.json", "browse");
    return mapSearchResults(query, payload, metadata?.page ?? 1);
  }

  async saveCloudflareBypassCookies(cookies: Cookie[] = []) {
    for (const cookie of cookies) {
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookies().setCookie(cookie);
      }
    }
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[] = [],
    _localStorage: Record<string, string> = {}
  ) {
    await this.saveCloudflareBypassCookies(cookies);
  }

  async bypassCloudflareRequest(request: Request): Promise<Request> {
    return request;
  }

  private cookies() {
    this.cookieStorageInterceptor ??= new CookieStorageInterceptor({
      storage: "stateManager"
    });
    return this.cookieStorageInterceptor;
  }

  private async fetchSeriesPayload(mangaId: string) {
    return this.fetchNextData(
      `series/${encodeURIComponent(mangaId)}.json?id=${encodeURIComponent(mangaId)}`,
      `series/${encodeURIComponent(mangaId)}`
    );
  }

  /**
   * Read a page's `pageProps`, from its `_next/data` route when that works and
   * from the server-rendered page (`pagePath`) when it does not.
   *
   * A build id goes stale whenever the site redeploys. Depending on the host
   * the stale data route answers 404 or a 200 HTML page, so anything that is
   * not a JSON payload is treated as stale and retried with a fresh id.
   */
  private async fetchNextData(dataPath: string, pagePath: string): Promise<unknown> {
    if (this.dataRoutesUnavailable) {
      return this.fetchPageProps(pagePath);
    }

    const alreadyFresh = await this.refreshBuildId(false);
    const firstPayload = await this.fetchDataRoute(dataPath);
    if (firstPayload) {
      return firstPayload;
    }

    if (!alreadyFresh) {
      await this.refreshBuildId(true);
      const retryPayload = await this.fetchDataRoute(dataPath);
      if (retryPayload) {
        return retryPayload;
      }
    }

    this.dataRoutesUnavailable = true;
    return this.fetchPageProps(pagePath);
  }

  private async fetchDataRoute(path: string) {
    const response = await this.schedule({
      url: `${FLAME_DOMAIN}/_next/data/${this.buildId}/${path}`,
      method: "GET"
    });

    this.assertNotChallenge(response);
    if (response.status !== 200) {
      // Usually a 404 for a stale build id; the page fallback reports
      // anything that is still failing there.
      return undefined;
    }

    return parseNextDataPayload(response.body);
  }

  private async fetchPageProps(pagePath: string) {
    const response = await this.schedule({
      url: pagePath ? `${FLAME_DOMAIN}/${pagePath}` : FLAME_DOMAIN,
      method: "GET"
    });
    this.assertNotChallenge(response);
    this.assertOk(response);

    const nextData = extractNextData(response.body);
    const pageProps = nextData?.props?.pageProps;
    if (!pageProps || typeof pageProps !== "object") {
      throw this.unexpectedResponse(response);
    }

    this.rememberBuildId(nextData?.buildId);
    return { pageProps };
  }

  /** Returns true when the id was just read from the homepage. */
  private async refreshBuildId(force: boolean): Promise<boolean> {
    if (!force) {
      if (this.buildId) {
        return false;
      }

      const cachedBuildId = Application.getState(BUILD_ID_STATE_KEY);
      if (typeof cachedBuildId === "string" && cachedBuildId) {
        this.buildId = cachedBuildId;
        return false;
      }
    }

    const response = await this.schedule({
      url: FLAME_DOMAIN,
      method: "GET"
    });
    this.assertNotChallenge(response);
    this.assertOk(response);

    const nextData = extractNextData(response.body);
    if (typeof nextData?.buildId !== "string" || !nextData.buildId) {
      throw this.unexpectedResponse(response);
    }

    this.rememberBuildId(nextData.buildId);
    return true;
  }

  private rememberBuildId(buildId: unknown) {
    if (typeof buildId !== "string" || !buildId || buildId === this.buildId) {
      return;
    }

    this.buildId = buildId;
    Application.setState(buildId, BUILD_ID_STATE_KEY);
  }

  private async schedule(request: Request): Promise<FetchedPage> {
    const [response, buffer] = await Application.scheduleRequest(request);
    return {
      request,
      status: response.status,
      headers: response.headers ?? {},
      body: Application.arrayBufferToUTF8String(buffer)
    };
  }

  /** Surface a Cloudflare interstitial as one, so the app offers the bypass. */
  private assertNotChallenge(response: FetchedPage) {
    if (
      headerValue(response.headers, "cf-mitigated") === "challenge" ||
      isCloudflareChallenge(response.body)
    ) {
      throw new CloudflareError({
        url: FLAME_DOMAIN,
        method: "GET"
      });
    }
  }

  private assertOk(response: { request: Request; status: number }) {
    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch ${response.request.url}; status code ${response.status}`
      );
    }
  }

  private unexpectedResponse(response: FetchedPage) {
    return new Error(
      `FlameComics sent ${describeHtml(response.body)} instead of series data for ${response.request.url}`
    );
  }
}

function headerValue(headers: Record<string, string> | undefined, name: string) {
  const match = Object.keys(headers ?? {}).find(
    (key) => key.toLowerCase() === name
  );
  return match ? headers?.[match] : undefined;
}

export const FlameComics = new FlameComicsExtension();
