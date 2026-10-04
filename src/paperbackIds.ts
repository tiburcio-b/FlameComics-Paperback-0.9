/**
 * Paperback rejects ids (manga, chapter and tag) that contain anything other
 * than ASCII letters, digits and `._-@()[]%?#+=/&:`. Site slugs routinely
 * carry apostrophes (`the-dan-family's-...`), so ids are percent-encoded on
 * the way in and decoded again before they are put back into a request.
 *
 * `%` itself is left alone so any id that was already valid stays byte-for-
 * byte identical, keeping titles already in the library matched up.
 */
const ALLOWED_ID_CHARACTER = /^[A-Za-z0-9._\-@()[\]%?#+=/&:]$/;

export function encodePaperbackId(value: string): string {
  let encoded = "";

  for (const character of value) {
    encoded += ALLOWED_ID_CHARACTER.test(character)
      ? character
      : percentEncode(character);
  }

  return encoded;
}

/** Undo {@link encodePaperbackId}; ids that were never encoded pass through. */
export function decodePaperbackId(value: string): string {
  if (!value.includes("%")) {
    return value;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Make a site-relative path safe to put in a URL without double-encoding:
 * existing `%XX` escapes and every RFC 3986 path character are kept.
 */
export function encodeUrlPath(path: string): string {
  let encoded = "";

  for (const character of path) {
    encoded += /^[A-Za-z0-9\-._~!$&'()*+,;=:@/%]$/.test(character)
      ? character
      : safeEncodeURIComponent(character);
  }

  return encoded;
}

function percentEncode(character: string): string {
  const encoded = safeEncodeURIComponent(character);
  if (encoded !== character) {
    return encoded;
  }

  // `encodeURIComponent` leaves `!'*~` untouched.
  return `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
}

/** A lone surrogate makes `encodeURIComponent` throw; encode U+FFFD instead. */
function safeEncodeURIComponent(character: string): string {
  try {
    return encodeURIComponent(character);
  } catch {
    return "%EF%BF%BD";
  }
}
