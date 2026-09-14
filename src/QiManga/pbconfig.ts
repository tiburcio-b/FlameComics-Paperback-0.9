import type { ExtensionInfo } from "@paperback/types";
import { ContentRating, SourceIntents } from "@paperback/types";

export default {
  name: "QiManga",
  description: "Extension that pulls manga, manhwa, and manhua from QiManga.",
  version: "1.0.5",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.EVERYONE,
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
      website: "https://qimanga.com"
    }
  ]
} satisfies ExtensionInfo;
