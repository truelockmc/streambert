#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# release.sh — Streambert APT release helper
#
# Usage:   ./release.sh <path-to-deb>
# Example: ./release.sh dist/streambert_1.7.0_amd64.deb
#
# Prerequisites:
#   sudo apt install dpkg-dev apt-utils gnupg
# ─────────────────────────────────────────────────────────────────────────────

set -e

DEB="$1"
GPG_EMAIL="anonyson@proton.me"
APT_BRANCH="apt"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# ── Validate ──────────────────────────────────────────────────────────────────
if [ -z "$DEB" ]; then
  echo "❌ Usage: ./release.sh <path-to-deb>"
  echo "   Example: ./release.sh dist/streambert_1.7.0_amd64.deb"
  exit 1
fi

if [ ! -f "$DEB" ]; then
  echo "❌ File not found: $DEB"
  exit 1
fi

for cmd in dpkg-scanpackages apt-ftparchive gpg; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "❌ Required tool not found: $cmd"
    echo "   Install with: sudo apt install dpkg-dev apt-utils gnupg"
    exit 1
  fi
done

DEB_FILENAME=$(basename "$DEB")
DEB_ABSPATH=$(realpath "$DEB")
VERSION=$(echo "$DEB_FILENAME" | grep -oP '\d+\.\d+\.\d+' || echo "release")

echo "📦 Publishing $DEB_FILENAME (v$VERSION)..."

# ── Stash and switch to apt branch ────────────────────────────────────────────
STASHED=0
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "💾 Stashing uncommitted changes..."
  git stash push -m "release.sh auto-stash"
  STASHED=1
fi

echo "🔀 Switching to $APT_BRANCH branch..."
git checkout "$APT_BRANCH"
git pull origin "$APT_BRANCH" --rebase 2>/dev/null || true

# ── Disable LFS for this branch just in case ─────────────────────────────────
if [ -f ".gitattributes" ]; then
  sed -i '/\.deb/d' .gitattributes
fi

mkdir -p pool/main

# ── Remove old .deb files ─────────────────────────────────────────────────────
find pool/main -name "*.deb" -exec git rm -f {} \; 2>/dev/null || true
mkdir -p pool/main

# ── Copy new .deb ─────────────────────────────────────────────────────────────
echo "📁 Copying $DEB_FILENAME..."
cp "$DEB_ABSPATH" "pool/main/$DEB_FILENAME"

# ── Generate Packages index ───────────────────────────────────────────────────
echo "📝 Generating Packages index..."
dpkg-scanpackages pool/main /dev/null > Packages
gzip -kf Packages

# ── Generate Release file ─────────────────────────────────────────────────────
echo "📝 Generating Release file..."
apt-ftparchive release . > Release

# ── Sign ──────────────────────────────────────────────────────────────────────
echo "🔐 Signing (GPG passphrase may be required)..."
gpg --clearsign --local-user "$GPG_EMAIL" -o InRelease Release
gpg -abs --local-user "$GPG_EMAIL" -o Release.gpg Release

# ── Commit — force-add .deb to bypass any LFS rules ──────────────────────────
echo "🚀 Committing and pushing..."
git add -f "pool/main/$DEB_FILENAME"
git add .gitattributes Packages Packages.gz Release Release.gpg InRelease 2>/dev/null || true

# Squash history so old .deb data is truly gone and branch stays small
git reset $(git rev-list --max-parents=0 HEAD)
git add -A
git add -f "pool/main/$DEB_FILENAME"
git commit -m "Release $VERSION"
git push origin "$APT_BRANCH" --force

# ── Switch back ───────────────────────────────────────────────────────────────
echo "🔀 Switching back to $CURRENT_BRANCH..."
git checkout "$CURRENT_BRANCH"
if [ "$STASHED" -eq 1 ]; then
  echo "📂 Restoring stashed changes..."
  git stash pop
fi

echo ""
echo "✅ Done! APT repo updated for v$VERSION"
echo ""
echo "Users install/update with:"
echo "  sudo apt update && sudo apt install streambert"
echo "  sudo apt update && sudo apt upgrade"
