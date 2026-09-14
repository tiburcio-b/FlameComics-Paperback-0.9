import { describe, expect, it } from "vitest";
import {
  pickImageValue,
  resolveImageUrl,
  unwrapOptimizerUrl,
  withVersion
} from "../src/urlUtils";

describe("url utils", () => {
  it("keeps absolute urls untouched", () => {
    expect(resolveImageUrl("https://cdn.example.com/a.webp", "https://site.test")).toBe(
      "https://cdn.example.com/a.webp"
    );
  });

  it("resolves site-relative and protocol-relative covers", () => {
    expect(resolveImageUrl("/covers/a.webp", "https://site.test")).toBe(
      "https://site.test/covers/a.webp"
    );
    expect(resolveImageUrl("covers/a.webp", "https://site.test/")).toBe(
      "https://site.test/covers/a.webp"
    );
    expect(resolveImageUrl("//cdn.example.com/a.webp", "https://site.test")).toBe(
      "https://cdn.example.com/a.webp"
    );
  });

  it("unwraps Next.js image optimizer urls", () => {
    const optimized =
      "/_next/image?url=https%3A%2F%2Fcdn.example.com%2Fa.webp&w=384&q=75";

    expect(unwrapOptimizerUrl(optimized)).toBe("https://cdn.example.com/a.webp");
    expect(resolveImageUrl(optimized, "https://site.test")).toBe(
      "https://cdn.example.com/a.webp"
    );
  });

  it("resolves an optimizer url that points at a site-relative asset", () => {
    expect(
      resolveImageUrl("/_next/image?url=%2Fcovers%2Fa.webp&w=384", "https://site.test")
    ).toBe("https://site.test/covers/a.webp");
  });

  it("returns an empty string for missing values", () => {
    expect(resolveImageUrl(undefined, "https://site.test")).toBe("");
    expect(resolveImageUrl("   ", "https://site.test")).toBe("");
  });

  it("reads renamed and wrapped cover fields", () => {
    expect(pickImageValue({ thumbnail: "a.webp" }, ["cover", "thumbnail"])).toBe("a.webp");
    expect(pickImageValue({ cover: { url: "b.webp" } }, ["cover"])).toBe("b.webp");
    expect(pickImageValue({}, ["cover"])).toBe("");
  });

  it("appends cache-busting tokens the way the site does", () => {
    expect(withVersion("https://cdn.test/a.webp", 1781623014)).toBe(
      "https://cdn.test/a.webp?1781623014"
    );
    expect(withVersion("https://cdn.test/a.webp?x=1", 42)).toBe(
      "https://cdn.test/a.webp?x=1&42"
    );
    expect(withVersion("https://cdn.test/a.webp", undefined)).toBe(
      "https://cdn.test/a.webp"
    );
  });
});
