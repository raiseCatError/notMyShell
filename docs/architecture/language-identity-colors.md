# Language identity colors

NMSh exposes GitHub Linguist's language colors as identity data for tool cards and project metadata. These colors identify a language only. They do not indicate success, warning, failure, focus, or any other UI state. `languageIdentity(name)` returns Chroma's existing identity category; `statusMeaning` is always undefined for it. Consumers use Chroma's capability fallback and retain text labels with NO_COLOR. The dataset does not repaint existing prompt themes.

The generated mapping is checked in at `src/languages/linguistLanguageColors.generated.ts`. Normal rendering reads only this local TypeScript data and makes no network request. `languageIdentityColor(name)` normalizes Unicode, case, and whitespace; it recognizes canonical names and aliases published by Linguist. Unknown names return the neutral `UNKNOWN_LANGUAGE_IDENTITY_COLOR` value.

## Provenance and license

The source is [`github-linguist/linguist`'s `lib/linguist/languages.yml`](https://github.com/github-linguist/linguist/blob/main/lib/linguist/languages.yml). Linguist describes the `color` field as its CSS color for a language, and documents that aliases are used for language lookup. The source repository is distributed under the [MIT License](https://github.com/github-linguist/linguist/blob/main/LICENSE), reproduced at `licenses/GITHUB-LINGUIST-MIT.txt`. The generated file records the exact Linguist commit used.

## Updating the mapping

Run `node scripts/update-linguist-language-colors.mjs` intentionally when updating the cached dataset. The script reads the current Linguist revision, fetches its pinned `languages.yml`, extracts only names, aliases, and valid `#RRGGBB` colors, and writes entries in stable name order. Review the generated diff and source revision with the normal code review. Build, tests, and runtime do not invoke this script or require network access.

To add or change consumers, import `languageIdentityColor` from `src/languages/linguistLanguageColors.ts`. Keep any contrast-adjusted display color local to that rendering consumer; do not overwrite the identity color or use it as a semantic status color.
