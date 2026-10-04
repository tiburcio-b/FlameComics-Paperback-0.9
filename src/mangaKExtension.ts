import {
  MANGAK_API_DOMAIN,
  MANGAK_DOMAIN,
  MANGAK_PAGE_SIZE,
  MANGAK_QUERY_LIMIT,
  extractMangaKNextData,
  mangaKSeriesIdFromSourceManga,
  mangaKSlugFromSourceManga,
  mangaKSortForSection,
  mapMangaKChapterDetails,
  mapMangaKChapters,
  mapMangaKDiscoverSectionItems,
  mapMangaKDiscoverSections,
  mapMangaKMangaDetails,
  mapMangaKSearchResults,
  type MangaKPageMetadata,
  type MangaKSearchQuery,
  type MangaKSourceMangaRef
} from "./mangaKParser";
import { decodePaperbackId, encodeUrlPath } from "./paperbackIds";
import { buildQueryString } from "./urlUtils";
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

const IMAGE_URL_PATTERN = /\.(avif|gif|jpeg|jpg|jxl|png|webp)(\?|$)/i;

class MangaKInterceptor extends PaperbackInterceptor {
  async interceptRequest(request: Request): Promise<Request> {
    const isApi = request.url.startsWith(MANGAK_API_DOMAIN);
    const isImage = IMAGE_URL_PATTERN.test(request.url);

    return {
      ...request,
      headers: {
        ...(request.headers ?? {}),
        referer: `${MANGAK_DOMAIN}/`,
        "user-agent": await Application.getDefaultUserAgent(),
        ...(isApi && !isImage
          ? {
              accept: "application/json, text/plain, */*",
              origin: MANGAK_DOMAIN
            }
          : {})
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

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: MangaKPageMetadata
  ) {
    const page = metadata?.page ?? 1;
    const { sort, window } = mangaKSortForSection(section.id);
    const query = buildQueryString({
      sort,
      page,
      limit: MANGAK_PAGE_SIZE,
      window
    });

    const payload = await this.fetchApi(`/titles/search?${query}`);
    return mapMangaKDiscoverSectionItems(section.id, payload, page);
  }

  async getMangaDetails(mangaId: string) {
    const payload = await this.fetchSeriesPayload(mangaId);
    return mapMangaKMangaDetails(mangaId, payload);
  }

  async getChapters(sourceManga: MangaKSourceMangaRef) {
    const seriesId = await this.resolveSeriesId(sourceManga);
    // `cv` is a cache-buster the site sends on every chapter-list call.
    const payload = await this.fetchApi(
      `/titles/${encodeURIComponent(seriesId)}/chapters?cv=${Date.now()}`
    );
    return mapMangaKChapters(sourceManga, payload);
  }

  async getChapterDetails(chapter: ChapterRef) {
    const payload = await this.fetchPage(chapter.chapterId);
    return mapMangaKChapterDetails(chapter, payload);
  }

  async getSearchResults(query: MangaKSearchQuery, metadata?: MangaKPageMetadata) {
    const page = metadata?.page ?? 1;

    // The endpoint rejects punctuation and over-long queries.
    const title = (query.title ?? "")
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .trim()
      .slice(0, MANGAK_QUERY_LIMIT);

    const search = buildQueryString({
      page,
      limit: MANGAK_PAGE_SIZE,
      q: title
    });
    const payload = await this.fetchApi(`/titles/search?${search}`);
    return mapMangaKSearchResults(payload, page);
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

  /**
   * Chapters are keyed by the API's series id. It normally rides along in the
   * saved manga, but a title restored from the library may predate that, so
   * fall back to reading it off the series page.
   */
  private async resolveSeriesId(sourceManga: MangaKSourceMangaRef) {
    const known = mangaKSeriesIdFromSourceManga(sourceManga);
    if (known) {
      return known;
    }

    const slug = mangaKSlugFromSourceManga(sourceManga);
    const payload = await this.fetchSeriesPayload(slug);
    const seriesId = mapMangaKMangaDetails(slug, payload).mangaInfo.additionalInfo
      .seriesId;

    if (!seriesId) {
      throw new Error(`Unable to resolve the MangaK series id for ${slug}`);
    }

    return seriesId;
  }

  private async fetchSeriesPayload(mangaId: string) {
    return this.fetchPage(mangaId);
  }

  private async fetchApi(path: string): Promise<unknown> {
    const response = await this.schedule({
      url: `${MANGAK_API_DOMAIN}${path}`,
      method: "GET"
    });

    this.assertOk(response);
    return JSON.parse(response.body);
  }

  /** `id` is a manga or chapter id: a site-relative path, possibly encoded. */
  private async fetchPage(id: string): Promise<unknown> {
    const response = await this.schedule({
      url: `${MANGAK_DOMAIN}/${encodeUrlPath(decodePaperbackId(id))}`,
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
