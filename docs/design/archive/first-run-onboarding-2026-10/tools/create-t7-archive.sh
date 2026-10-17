#!/usr/bin/env bash
# Creates the durable first-run onboarding design archive on the T7 Shield.
# Provenance record: it was run once, on 2026-10-17, before the approved
# direction was implemented. It copies (never moves) every source; it refuses
# to overwrite an existing archive.
set -euo pipefail

qa=/Volumes/T7Tmp/ai-dev/qa/post-v020-preferences-onboarding
repo=/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/post-v020-preferences-onboarding
commit=13a47f8798df3d74c8b887426f6cdd794e20af5a
dest="/Volumes/T7 Shield/NMSh Design Archive/first-run-onboarding-2026-10-17"

[[ -d "/Volumes/T7 Shield" ]] || { echo "The T7 Shield is not mounted; nothing was written." >&2; exit 1; }
[[ ! -e "$dest" ]] || { echo "$dest already exists; refusing to overwrite it." >&2; exit 1; }
[[ "$(git -C "$repo" rev-parse feature/post-v020-preferences-onboarding)" == "$commit" ]] \
  || { echo "The feature branch is no longer at $commit; archive from that commit explicitly." >&2; exit 1; }

mkdir -p "$dest/review-package" "$dest/superseded/source-13a47f8"

# 1. The whole design exploration, byte for byte. Resource forks, extended
#    attributes and ACLs are not copied, so exFAT gets no AppleDouble files;
#    Finder's .DS_Store is the only file left out.
ditto --norsrc --noextattr --noacl "$qa/design-concepts" "$dest/design-concepts"
find "$dest/design-concepts" -name .DS_Store -type f -delete

# 2. The packaged review the maintainer downloaded.
ditto --norsrc --noextattr --noacl "$qa/design-review.zip" "$dest/review-package/design-review.zip"

# 3. The superseded static-modal implementation: its renderer captures, the
#    script that produced them, the onboarding source, tests and docs as they
#    were at the provenance commit, and the full repository history to that commit.
ditto --norsrc --noextattr --noacl "$qa/onboarding-captures" "$dest/superseded/static-modal-captures"
ditto --norsrc --noextattr --noacl "$qa/onboarding-captures.mts" "$dest/superseded/static-modal-captures.mts"
for path in \
  src/setup/SetupCat.ts src/setup/SetupPreview.ts src/prompt/configuration.ts src/cursor/palette.ts \
  src/idle/scenes.ts src/idle/catSprite.ts src/output/Welcome.ts \
  tests/postV020Onboarding.test.ts tests/postV020Preferences.test.ts tests/setupQuickPreview.test.ts \
  scripts/dev/post-v020-previews.ts \
  docs/design/post-v020-preferences-onboarding.md docs/testing/post-v020-preferences-onboarding.md; do
  mkdir -p "$dest/superseded/source-13a47f8/$(dirname "$path")"
  git -C "$repo" show "$commit:$path" > "$dest/superseded/source-13a47f8/$path"
done
git -C "$repo" bundle create "$dest/superseded/notMyShell-13a47f8.bundle" feature/post-v020-preferences-onboarding
git -C "$repo" bundle verify "$dest/superseded/notMyShell-13a47f8.bundle" >/dev/null

echo "Archived to: $dest"
