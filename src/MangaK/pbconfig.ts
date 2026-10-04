import type { ExtensionInfo } from "@paperback/types";
import { ContentRating, SourceIntents } from "@paperback/types";

export default {
  name: "MangaK",
  description: "Extension that pulls manga, manhwa, and manhua from MangaK.",
  version: "1.1.1",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.ADULT,
  capabilities: [
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING
  ],
  badges: [],
  developers: [
    {
      name: "btninja",
      website: "https://github.com/btninja",
      github: "https://github.com/btninja"
    },
    {
      name: "Local 0.9 extension",
      website: "https://mangak.io"
    }
  ]
} satisfies ExtensionInfo;
