#!/usr/bin/env bash
# Build enriched GitHub Release notes for a version tag.
# Used by .github/workflows/release.yml and scripts/backfill-github-releases.sh.
#
# Usage: scripts/build-release-notes.sh <tag> [previous-tag]
# Expects package.json in the current working directory.
set -euo pipefail

TAG="${1:?tag required (e.g. v1.3.9)}"
PREV="${2:-}"

VERSION="${TAG#v}"
PKG="$(node -p "require('./package.json').name")"
REPO="${GITHUB_REPOSITORY:-alisaitteke/photoshop-mcp}"
NPM_URL="https://www.npmjs.com/package/${PKG}/v/${VERSION}"
README_URL="https://github.com/${REPO}/blob/${TAG}/README.md"

NPM_NOTE=""
if command -v npm >/dev/null 2>&1; then
  if npm view "${PKG}@${VERSION}" version 2>/dev/null | grep -qx "${VERSION}"; then
    NPM_NOTE="✅ Published on npm."
  else
    NPM_NOTE="⏳ Not on npm yet — \`npm publish\` usually follows shortly after this GitHub release."
  fi
fi

if [[ -n "$PREV" ]]; then
  COMPARE_URL="https://github.com/${REPO}/compare/${PREV}...${TAG}"
  CHANGES="$(git log "${PREV}..${TAG}" --pretty=format:'- %s (`%h`)' --no-merges || true)"
else
  COMPARE_URL=""
  CHANGES="$(git log -30 "${TAG}" --pretty=format:'- %s (`%h`)' --no-merges || true)"
fi

[[ -n "$CHANGES" ]] || CHANGES="- No commits in range."

{
  echo "## Install"
  echo
  echo '```bash'
  echo "# MCP server (Cursor, Claude Desktop, etc.)"
  echo "npx ${PKG}@${VERSION}"
  echo
  echo "# Standalone web UI"
  echo "npx -p ${PKG}@${VERSION} photoshop-mcp-ui"
  echo
  echo "# Pin in package.json"
  echo "npm install ${PKG}@${VERSION}"
  echo '```'
  echo
  echo "## Links"
  echo
  echo "| | |"
  echo "| --- | --- |"
  echo "| **npm** | [${PKG}@${VERSION}](${NPM_URL}) |"
  echo "| **Docs** | [README](${README_URL}) |"
  if [[ -n "$COMPARE_URL" ]]; then
    echo "| **Full changelog** | [${PREV}...${TAG}](${COMPARE_URL}) |"
  fi
  echo
  echo "## Requirements"
  echo
  echo "- Node.js ≥ 18"
  echo "- Adobe Photoshop (Windows or macOS)"
  echo
  if [[ -n "$NPM_NOTE" ]]; then
    echo "> ${NPM_NOTE}"
    echo
  fi
  echo "## What's Changed"
  echo
  echo "$CHANGES"
} 
