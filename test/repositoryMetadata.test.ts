import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import flameConfig from "../src/FlameComics/pbconfig";
import qiMangaConfig from "../src/QiManga/pbconfig";
import mangaKConfig from "../src/MangaK/pbconfig";
import {
  builtWithMetadata,
  repositoryPackageVersion,
  repositoryMetadata,
  sourceMetadataList
} from "../scripts/repository-metadata.mjs";

describe("0.9 repository metadata", () => {
  it("declares a repository object required by Paperback 0.9 repos", () => {
    expect(repositoryMetadata).toEqual({
      name: "btninja Paperback 0.9",
      description: "Paperback 0.9 extensions for FlameComics, QiManga, and MangaK."
    });
  });

  it("declares 0.9-compatible toolchain metadata", () => {
    expect(builtWithMetadata).toEqual({
      toolchain: "1.0.0-alpha.92",
      types: "1.0.0-alpha.92"
    });
  });

  it("keeps the repository package version in step with package.json", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    );

    expect(repositoryPackageVersion).toBe(packageJson.version);
  });

  it("declares both source entries for the repository", () => {
    expect(sourceMetadataList.map((source) => source.id)).toEqual([
      "FlameComics",
      "QiManga",
      "MangaK"
    ]);
    expect(sourceMetadataList.find((source) => source.id === "QiManga")).toMatchObject({
      name: "QiManga",
      icon: "icon.png",
      contentRating: "SAFE",
      capabilities: [1, 16, 4, 64]
    });
    expect(sourceMetadataList.find((source) => source.id === "MangaK")).toMatchObject({
      name: "MangaK",
      icon: "icon.png",
      contentRating: "ADULT",
      capabilities: [1, 16, 4, 64]
    });
    expect(sourceMetadataList.find((source) => source.id === "FlameComics")).toMatchObject({
      name: "FlameComics",
      icon: "icon.png",
      contentRating: "SAFE",
      capabilities: [1, 16, 4, 64]
    });
  });

  // The install page reads repository-metadata.mjs while the bundle reads
  // pbconfig.ts. If the two drift, Paperback never offers the update.
  it("matches every source version to the pbconfig the bundle is built from", () => {
    const configs: Record<string, { version: string }> = {
      FlameComics: flameConfig,
      QiManga: qiMangaConfig,
      MangaK: mangaKConfig
    };

    for (const source of sourceMetadataList as Array<{ id: string; version: string }>) {
      expect(source.version).toBe(configs[source.id]?.version);
    }
  });
});
