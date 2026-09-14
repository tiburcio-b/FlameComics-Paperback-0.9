import {
  MANGAK_DOMAIN,
  extractMangaKNextData,
  mangaKSlugFromSourceManga,
  mapMangaKChapterDetails,
  mapMangaKChapters,
  mapMangaKDiscoverSectionItems,
  mapMangaKDiscoverSections,
  mapMangaKMangaDetails,
  mapMangaKSearchResults,
  type MangaKSearchQuery,
  type MangaKSourceMangaRef
} from "./mangaKParser";
import {
  BasicRateLimiter,
  CloudflareError,
  CookieStorageInterceptor,
  PaperbackInterceptor,
  type Cookie,
  type Request,
  type Response
} from "@paperback/types";

type DiscoverSection = {
  id: string;
  title: string;
  type: number;
};

type ChapterRef = {
  chapterId: string;
  sourceManga: MangaKSourceMangaRef;
};

class MangaKInterceptor extends PaperbackInterceptor {
  async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...(request.headers ?? {}),
        referer: `${MANGAK_DOMAIN}/`,
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

export class MangaKExtension {
  private cookieStorageInterceptor?: CookieStorageInterceptor;
  private globalRateLimiter = new BasicRateLimiter("mangak-rate-limiter", {
    numberOfRequests: 8,
    bufferInterval: 1,
    ignoreImages: true
  });
  private mangaKInterceptor = new MangaKInterceptor("mangak");

  async initialise() {
    this.globalRateLimiter.registerInterceptor();
    this.cookies().registerInterceptor();
    this.mangaKInterceptor.registerInterceptor();
  }

  async interceptRequest(request: Request): Promise<Request> {
    return this.mangaKInterceptor.interceptRequest(request);
  }

  async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer
  ): Promise<ArrayBuffer> {
    return this.mangaKInterceptor.interceptResponse(request, response, data);
  }

  async getDiscoverSections() {
    return mapMangaKDiscoverSections();
  }

  async getDiscoverSectionItems(section: DiscoverSection, _metadata?: unknown) {
    const payload = await this.fetchPage("/home");
    return mapMangaKDiscoverSectionItems(section.id, payload);
  }

  async getMangaDetails(mangaId: string) {
    const payload = await this.fetchSeriesPayload(mangaId);
    return mapMangaKMangaDetails(mangaId, payload);
  }

  async getChapters(sourceManga: MangaKSourceMangaRef) {
    const payload = await this.fetchSeriesPayload(mangaKSlugFromSourceManga(sourceManga));
    return mapMangaKChapters(sourceManga, payload);
  }

  async getChapterDetails(chapter: ChapterRef) {
    const slug = mangaKSlugFromSourceManga(chapter.sourceManga);
    const payload = await this.fetchPage(
      `/${encodeURIComponent(slug)}/${encodeURIComponent(chapter.chapterId)}`
    );
    return mapMangaKChapterDetails(chapter, payload);
  }

  async getSearchResults(query: MangaKSearchQuery, metadata?: { page?: number }) {
    const page = metadata?.page ?? 1;
    const title = (query.title ?? "").trim();
    const params = new URLSearchParams();
    if (title) {
      params.set("keyword", title);
    }
    params.set("page", String(page));

    const payload = await this.fetchPage(`/search?${params.toString()}`);
    return mapMangaKSearchResults(payload);
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
    return this.fetchPage(`/${encodeURIComponent(mangaId)}`);
  }

  private async fetchPage(path: string): Promise<unknown> {
    const response = await this.schedule({
      url: `${MANGAK_DOMAIN}${path}`,
      method: "GET"
    });

    this.assertOk(response);
    return extractMangaKNextData(response.body);
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

export const MangaK = new MangaKExtension();
