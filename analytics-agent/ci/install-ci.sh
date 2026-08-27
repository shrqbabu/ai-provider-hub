#!/usr/bin/env bash
#
# Installs the analytics-agent CI workflow into .github/workflows/.
#
# Why this script exists
# ----------------------
# The agent integration that authored this subtree does not hold the GitHub
# App `workflows` permission, so any push that creates or edits a file under
# .github/workflows/ is rejected by GitHub:
#
#   refusing to allow a GitHub App to create or update workflow
#   `.github/workflows/analytics-agent.yml` without `workflows` permission
#
# Your own account does have that permission. Run this once from the repository
# root and the workflow goes live.
#
# Usage:
#   ./analytics-agent/ci/install-ci.sh          # copy, commit and push
#   ./analytics-agent/ci/install-ci.sh --no-push  # copy and commit only
#
set -euo pipefail

SOURCE="analytics-agent/ci/analytics-agent.yml"
TARGET=".github/workflows/analytics-agent.yml"
PUSH=1
[ "${1:-}" = "--no-push" ] && PUSH=0

if [ ! -f "$SOURCE" ]; then
    echo "error: run this from the repository root (cannot find $SOURCE)" >&2
    exit 1
fi

mkdir -p "$(dirname "$TARGET")"
cp "$SOURCE" "$TARGET"
echo "copied  $SOURCE -> $TARGET"

git add "$TARGET"

if git diff --cached --quiet; then
    echo "nothing to commit: $TARGET is already up to date"
    exit 0
fi

git commit -m "Add analytics-agent CI workflow (backend tests, Android build, secret scan)"
echo "committed"

if [ "$PUSH" = "1" ]; then
    BRANCH="$(git rev-parse --abbrev-ref HEAD)"
    git push origin "$BRANCH"
    echo
    echo "pushed to $BRANCH — the workflow runs on the next push, or trigger it now:"
    echo "  gh workflow run analytics-agent.yml --ref $BRANCH"
else
    echo "skipped push (--no-push). Push when ready:"
    echo "  git push origin \$(git rev-parse --abbrev-ref HEAD)"
fi
