#!/usr/bin/env bash
#
# Tag a release so .github/workflows/build-fork-image.yml builds and pushes the
# AIO image to GHCR.
#
# The version comes from the root package.json, so package.json stays the single
# source of truth and the tag can never drift from it.
#
#   ./scripts/release.sh                  # tag the current package.json version
#   ./scripts/release.sh --bump patch     # 3.0.1 -> 3.0.2, commit, then tag
#   ./scripts/release.sh --dry-run        # show what would happen, change nothing
#
set -euo pipefail

cd "$(dirname "$0")/.."

BUMP=""
DRY_RUN=0
REMOTE="origin"

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump)     BUMP="${2:-}"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --remote)   REMOTE="${2:-}"; shift 2 ;;
    -h|--help)  usage 0 ;;
    *)          echo "Unknown option: $1" >&2; usage 1 ;;
  esac
done

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

read_version() {
  node -p "require('./package.json').version"
}

# --- preflight ---------------------------------------------------------------

command -v node >/dev/null || fail "node is required to read package.json"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "not a git repository"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" != "HEAD" ]] || fail "detached HEAD - check out a branch first"

# A dirty tree means the tag would not describe what actually gets built.
if [[ -n "$(git status --porcelain)" ]]; then
  fail "working tree is dirty - commit or stash first (git status)"
fi

git remote get-url "$REMOTE" >/dev/null 2>&1 || fail "no git remote named '$REMOTE'"

say "Fetching tags from $REMOTE..."
git fetch --tags --quiet "$REMOTE" || fail "could not reach $REMOTE"

# --- version -----------------------------------------------------------------

if [[ -n "$BUMP" ]]; then
  case "$BUMP" in
    patch|minor|major) ;;
    *) fail "--bump must be patch, minor or major (got '$BUMP')" ;;
  esac

  CURRENT="$(read_version)"
  VERSION="$(node -e "
    const [maj, min, pat] = process.argv[1].split('.').map(Number);
    const bump = process.argv[2];
    if ([maj, min, pat].some(Number.isNaN)) {
      console.error('package.json version is not X.Y.Z: ' + process.argv[1]);
      process.exit(1);
    }
    console.log(
      bump === 'major' ? \`\${maj + 1}.0.0\`
      : bump === 'minor' ? \`\${maj}.\${min + 1}.0\`
      : \`\${maj}.\${min}.\${pat + 1}\`
    );
  " "$CURRENT" "$BUMP")"

  say "Bumping version: $CURRENT -> $VERSION"
else
  VERSION="$(read_version)"
fi

# The workflow only fires on tags matching '*.*.*'.
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || fail "version '$VERSION' is not X.Y.Z, so the build workflow will not trigger"

TAG="$VERSION"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  fail "tag $TAG already exists locally - use --bump, or delete it with: git tag -d $TAG"
fi

if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/$TAG" >/dev/null 2>&1; then
  fail "tag $TAG already exists on $REMOTE - bump the version instead of moving a published tag"
fi

# --- plan --------------------------------------------------------------------

REPO_PATH="$(git remote get-url "$REMOTE" \
  | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##')"
IMAGE="ghcr.io/$(echo "$REPO_PATH" | tr '[:upper:]' '[:lower:]')"
MAJOR_MINOR="${VERSION%.*}"

echo
say "Release plan"
echo "  branch      $BRANCH"
echo "  commit      $(git rev-parse --short HEAD)"
echo "  tag         $TAG"
echo "  remote      $REMOTE ($REPO_PATH)"
[[ -n "$BUMP" ]] && echo "  bump        writes version to package.json and commits it"
echo
echo "  CI will push:"
echo "    $IMAGE:$VERSION"
echo "    $IMAGE:$MAJOR_MINOR"
echo "    $IMAGE:latest"
echo "    $IMAGE:sha-$(git rev-parse --short=7 HEAD)"
echo

if [[ "$DRY_RUN" -eq 1 ]]; then
  say "Dry run - nothing was changed."
  exit 0
fi

read -r -p "Create and push this tag? [y/N] " reply
[[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

# --- execute -----------------------------------------------------------------

if [[ -n "$BUMP" ]]; then
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = process.argv[1];
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  " "$VERSION"

  git add package.json
  # commitlint (config-conventional) runs on commit-msg, so keep the format.
  git commit -m "chore(release): bump version to $VERSION"
  git push "$REMOTE" "$BRANCH"
fi

git tag -a "$TAG" -m "Release $TAG"
git push "$REMOTE" "$TAG"

echo
say "Pushed tag $TAG."
echo "Watch the build:  https://github.com/$REPO_PATH/actions"
echo "Packages:         https://github.com/$REPO_PATH/pkgs/container/${REPO_PATH##*/}"
echo
echo "Once the workflow is green, on the Debian server:"
echo "  cd /opt/hoppscotch && docker compose pull && docker compose up -d"
