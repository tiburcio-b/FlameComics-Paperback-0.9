/**
 * Shared URL helpers.
 *
 * Cover art is the single most fragile thing in these sources: every site
 * returns it in a slightly different shape (bare filename, site-relative path,
 * protocol-relative URL, or a Next.js image-optimizer wrapper), and any one of
 * those variants rendered verbatim gives Paperback an unloadable thumbnail.
 */

/**
 * Turn whatever a site returned for an image into an absolute URL.
 *
 * `baseOrigin` must be the origin the value was served from, so that
 * site-relative paths resolve the same way a browser on that page would.
 */
export function resolveImageUrl(value: unknown, baseOrigin: string): string {
  const raw = asTrimmedString(value);
  if (!raw) {
    return "";
  }

  const unwrapped = unwrapOptimizerUrl(raw);

  if (/^https?:\/\//i.test(unwrapped)) {
    return unwrapped;
  }
  if (unwrapped.startsWith("//")) {
    return `https:${unwrapped}`;
  }

  const origin = baseOrigin.replace(/\/+$/, "");
  return unwrapped.startsWith("/")
    ? `${origin}${unwrapped}`
    : `${origin}/${unwrapped}`;
}

/**
 * Next.js serves covers through `/_next/image?url=<encoded>&w=..&q=..`.
 * Paperback fetches images directly, so the wrapper only adds a resize step
 * that can 400 when `w`/`q` are dropped. Unwrap to the underlying asset.
 */
export function unwrapOptimizerUrl(value: string): string {
  if (!/\/_next\/image/.test(value)) {
    return value;
  }

  const encoded = value.match(/[?&]url=([^&]+)/)?.[1];
  if (!encoded) {
    return value;
  }

  try {
    return decodeURIComponent(encoded);
  } catch {
    return value;
  }
}

/**
 * Read the first usable cover value out of a record, tolerating the field
 * having been renamed and tolerating `{ url }` / `{ src }` wrappers.
 */
export function pickImageValue(
  record: Record<string, unknown> | undefined,
  keys: string[]
): string {
  if (!record) {
    return "";
  }

  for (const key of keys) {
    const direct = asTrimmedString(record[key]);
    if (direct) {
      return direct;
    }

    const nested = record[key];
    if (nested && typeof nested === "object") {
      const wrapped = nested as Record<string, unknown>;
      const inner =
        asTrimmedString(wrapped.url) ||
        asTrimmedString(wrapped.src) ||
        asTrimmedString(wrapped.path);
      if (inner) {
        return inner;
      }
    }
  }

  return "";
}

/** Append a cache-busting token as a bare query string, as the site does. */
export function withVersion(url: string, version: unknown): string {
  const token = asTrimmedString(version);
  if (!url || !token) {
    return url;
  }

  return url.includes("?") ? `${url}&${token}` : `${url}?${token}`;
}

function asTrimmedString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

/**
 * Build a query string the way `URLSearchParams` would (spaces as `+`). The
 * Paperback runtime has no `URLSearchParams`; empty values are dropped.
 */
export function buildQueryString(
  params: Record<string, string | number | undefined>
): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${formEncode(key)}=${formEncode(String(value))}`)
    .join("&");
}

function formEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}
