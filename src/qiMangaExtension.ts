import {
  QIMANGA_API_DOMAIN,
  QIMANGA_DOMAIN,
  mapQiChapterDetails,
  mapQiChapters,
  mapQiDiscoverSectionItems,
  mapQiDiscoverSections,
  mapQiMangaDetails,
  mapQiSearchResults,
  qiSlugFromSourceManga,
  type QiSearchQuery,
  type QiSourceMangaRef
} from "./qiMangaParser";
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
  sourceManga: QiSourceMangaRef;
};

const MAX_CHAPTER_PAGES = 200;
const IMAGE_URL_PATTERN = /\.(avif|gif|jpeg|jpg|jxl|png|webp)(\?|$)/i;

class QiMangaInterceptor extends PaperbackInterceptor {
  async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_URL_PATTERN.test(request.url);

    return {
      ...request,
      headers: {
        ...(request.headers ?? {}),
        referer: `${QIMANGA_DOMAIN}/`,
        // Browsers send Origin for the XHR API calls but never for image
        // loads; sending it anyway is a cheap way to earn a CDN 403.
        ...(isImage ? {} : { origin: QIMANGA_DOMAIN }),
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

export class QiMangaExtension {
  private cookieStorageInterceptor?: CookieStorageInterceptor;
  private globalRateLimiter = new BasicRateLimiter("qimanga-rate-limiter", {
    numberOfRequests: 8,
    bufferInterval: 1,
    ignoreImages: true
  });
  private qiMangaInterceptor = new QiMangaInterceptor("qimanga");

  async initialise() {
    this.globalRateLimiter.registerInterceptor();
    this.cookies().registerInterceptor();
    this.qiMangaInterceptor.registerInterceptor();
  }

  async interceptRequest(request: Request): Promise<Request> {
    return this.qiMangaInterceptor.interceptRequest(request);
  }

  async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer
  ): Promise<ArrayBuffer> {
    return this.qiMangaInterceptor.interceptResponse(request, response, data);
  }

  async getDiscoverSections() {
    return mapQiDiscoverSections();
  }

  async getDiscoverSectionItems(section: DiscoverSection, _metadata?: unknown) {
    const payload = await this.fetchJson("v1/home");
    return mapQiDiscoverSectionItems(section.id, payload);
  }

  async getMangaDetails(mangaId: string) {
    const payload = await this.fetchJson(`v1/series/${encodeURIComponent(mangaId)}`);
    return mapQiMangaDetails(mangaId, payload);
  }

  async getChapters(sourceManga: QiSourceMangaRef) {
    const slug = encodeURIComponent(qiSlugFromSourceManga(sourceManga));
    const chapters: unknown[] = [];
    let page = 1;

    for (;;) {
      const payload = await this.fetchJson(
        `v1/series/${slug}/chapters?page=${page}&perPage=30&sort=desc`
      );
      chapters.push(...this.payloadData(payload));

      const nextPage = this.nextPage(payload);
      // Only follow a cursor that actually advances, so a server that keeps
      // echoing the current page cannot spin this loop forever.
      if (nextPage <= page || page >= MAX_CHAPTER_PAGES) {
        break;
      }
      page = nextPage;
    }

    return mapQiChapters(sourceManga, { data: chapters });
  }

  async getChapterDetails(chapter: ChapterRef) {
    const slug = encodeURIComponent(qiSlugFromSourceManga(chapter.sourceManga));
    const payload = await this.fetchJson(
      `v1/series/${slug}/chapters/${encodeURIComponent(chapter.chapterId)}`
    );
    return mapQiChapterDetails(chapter, payload);
  }

  async getSearchResults(query: QiSearchQuery, metadata?: { page?: number }) {
    const page = metadata?.page ?? 1;
    const title = (query.title ?? "").trim();
    const path = title
      ? `v1/series/search?q=${encodeURIComponent(title)}&page=${page}&perPage=20`
      : `v1/series?page=${page}&perPage=20&sort=latest`;
    const payload = await this.fetchJson(path);

    return mapQiSearchResults(payload);
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

  private async fetchJson(path: string): Promise<unknown> {
    const response = await this.schedule({
      url: `${QIMANGA_API_DOMAIN}/${path}`,
      method: "GET"
    });

    this.assertOk(response);
    return JSON.parse(response.body);
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

  private nextPage(payload: unknown) {
    if (!payload || typeof payload !== "object") {
      return 0;
    }

    const next = (payload as { next?: unknown }).next;
    return typeof next === "number" ? next : 0;
  }

  private payloadData(payload: unknown) {
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const data = (payload as { data?: unknown }).data;
    return Array.isArray(data) ? data : [];
  }

}

export const QiManga = new QiMangaExtension();
