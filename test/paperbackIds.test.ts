import { describe, expect, it } from "vitest";
import {
  decodePaperbackId,
  encodePaperbackId,
  encodeUrlPath
} from "../src/paperbackIds";
import { buildQueryString } from "../src/urlUtils";

/** The rule the app enforces on manga, chapter and tag ids. */
const PAPERBACK_ID = /^[A-Za-z0-9._\-@()[\]%?#+=/&:]+$/;

describe("paperback ids", () => {
  it("encodes characters the app rejects and decodes them back", () => {
    const slug = "the-dan-family's-good-for-nothing-is-too-strong";
    const id = encodePaperbackId(slug);

    expect(id).toBe("the-dan-family%27s-good-for-nothing-is-too-strong");
    expect(id).toMatch(PAPERBACK_ID);
    expect(decodePaperbackId(id)).toBe(slug);
  });

  it("encodes every character encodeURIComponent leaves alone", () => {
    for (const slug of ["a!b", "a*b", "a~b", "a b", "café", "칼", "a😀b"]) {
      const id = encodePaperbackId(slug);
      expect(id).toMatch(PAPERBACK_ID);
      expect(decodePaperbackId(id)).toBe(slug);
    }
  });

  it("leaves ids that were already valid untouched", () => {
    for (const id of ["sample", "series/154", "chapter-1.5", "a%C3%A9", "x(y)[z]"]) {
      expect(encodePaperbackId(id)).toBe(id);
    }
    expect(decodePaperbackId("plain-slug")).toBe("plain-slug");
    expect(decodePaperbackId("100%-love")).toBe("100%-love");
  });

  it("encodes paths for URLs without double-encoding existing escapes", () => {
    expect(encodeUrlPath("manga/the-dan-family's")).toBe("manga/the-dan-family's");
    expect(encodeUrlPath("manga/caf%C3%A9")).toBe("manga/caf%C3%A9");
    expect(encodeUrlPath("manga/a b")).toBe("manga/a%20b");
  });
});

describe("query strings", () => {
  it("matches URLSearchParams without needing it", () => {
    const params = { sort: "popular", page: 1, q: "immortal spearman", window: "" };

    expect(buildQueryString(params)).toBe("sort=popular&page=1&q=immortal+spearman");
    expect(buildQueryString(params)).toBe(
      new URLSearchParams({ sort: "popular", page: "1", q: "immortal spearman" }).toString()
    );
  });
});
