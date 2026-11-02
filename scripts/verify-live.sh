#!/usr/bin/env bash
# Check that the files a Blackout site serves were built from github.com/dapss/blackout by its
# GitHub Actions workflow, using the signed build provenance published on the repo.
#
# Needs: curl and the GitHub CLI (gh). Usage: scripts/verify-live.sh [site-url]
set -euo pipefail

SITE="${1:-https://blackout-redact.pages.dev}"
SITE="${SITE%/}"
REPO="dapss/blackout"

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
cd "$dir"

# Download exactly what the site serves (no compression, so the bytes match the build).
curl -fsS "$SITE/" -o index.html
curl -fsS "$SITE/favicon.svg" -o favicon.svg

# The page names its script and stylesheet; the script names the two workers it starts.
names="$(grep -oE 'assets/[A-Za-z0-9._]+-[A-Za-z0-9_-]{8}\.(js|mjs|css)' index.html | sort -u)"
for path in $names; do curl -fsS "$SITE/$path" -o "$(basename "$path")"; done
workers="$(cat ./*.js | grep -oE '(export\.worker|pdf\.worker\.min)-[A-Za-z0-9_-]{8}\.m?js' | sort -u)"
for name in $workers; do curl -fsS "$SITE/assets/$name" -o "$name"; done

echo "Checking $(ls | wc -l | tr -d ' ') files from $SITE against $REPO"
failed=0
for file in *; do
  if commit="$(gh attestation verify "$file" --repo "$REPO" --format json \
      --jq ".[0].verificationResult.signature.certificate.sourceRepositoryDigest" 2>/dev/null)"; then
    echo "  ok      $file  (commit ${commit:0:7})"
  else
    echo "  FAILED  $file"
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "Some files could not be verified. Don't trust this copy."
  exit 1
fi
echo "All files were built by $REPO's GitHub Actions workflow."
