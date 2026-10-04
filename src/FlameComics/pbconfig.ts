import type { ExtensionInfo } from "@paperback/types";
import { ContentRating, SourceIntents } from "@paperback/types";

export default {
  name: "FlameComics",
  description: "Extension that pulls manga, manhwa, and manhua from FlameComics.",
  version: "1.0.7",
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
      name: "IvanMatthew",
      website: "http://github.com/Ivanmatthew",
      github: "https://github.com/Ivanmatthew"
    },
    {
      name: "Local 0.9 migration",
      website: "https://flamecomics.xyz"
    }
  ]
} satisfies ExtensionInfo;
