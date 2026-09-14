import {
  FLAME_DOMAIN,
  extractBuildId,
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
        "user-agent": await Application.getDefaultUserAgent()
      }
    };
  }

  async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge") {
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
    const payload = await this.fetchJsonWithBuildId("index.json");
    return mapDiscoverSectionList(payload);
  }

  async getDiscoverSectionItems(section: DiscoverSection, _metadata?: unknown) {
    const payload = await this.fetchJsonWithBuildId("index.json");
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
    const chapterPayload = await this.fetchJsonWithBuildId(
      `series/${mangaId}/${encodeURIComponent(token)}.json?id=${encodeURIComponent(mangaId)}&token=${encodeURIComponent(token)}`
    );

    return mapChapterDetails(mangaId, token, chapterPayload);
  }

  async getSearchResults(query: SearchQuery, metadata?: SearchPageMetadata) {
    const payload = await this.fetchJsonWithBuildId("browse.json");
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
    return this.fetchJsonWithBuildId(
      `series/${encodeURIComponent(mangaId)}.json?id=${encodeURIComponent(mangaId)}`
    );
  }

  private async fetchJsonWithBuildId(path: string): Promise<unknown> {
    await this.refreshBuildId(false);
    let response = await this.schedule({
      url: `${FLAME_DOMAIN}/_next/data/${this.buildId}/${path}`,
      method: "GET"
    });

    if (response.status === 404) {
      await this.refreshBuildId(true);
      response = await this.schedule({
        url: `${FLAME_DOMAIN}/_next/data/${this.buildId}/${path}`,
        method: "GET"
      });
    }

    this.assertOk(response);
    return JSON.parse(response.body);
  }

  private async refreshBuildId(force: boolean) {
    if (!force) {
      if (this.buildId) {
        return;
      }

      const cachedBuildId = Application.getState(BUILD_ID_STATE_KEY);
      if (typeof cachedBuildId === "string" && cachedBuildId) {
        this.buildId = cachedBuildId;
        return;
      }
    }

    const response = await this.schedule({
      url: FLAME_DOMAIN,
      method: "GET"
    });
    this.assertOk(response);

    this.buildId = extractBuildId(response.body);
    Application.setState(this.buildId, BUILD_ID_STATE_KEY);
  }

  private async schedule(request: Request) {
    const [response, buffer] = await Application.scheduleRequest(request);
    return {
      request,
      status: response.status,
      headers: response.headers ?? {},
      body: Application.arrayBufferToUTF8String(buffer)
    };
  }

  private assertOk(response: { request: Request; status: number }) {
    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch ${response.request.url}; status code ${response.status}`
      );
    }
  }
}

export const FlameComics = new FlameComicsExtension();
