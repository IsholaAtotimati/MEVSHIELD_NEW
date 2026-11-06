#!/usr/bin/env bash
#
# Push HEAD to both remotes in one command:
#
#   origin  — the working mirror (the branch keeps its own name)
#   eykegai — the Coolify deploy source (always development)
#
# Staging deploys come from Eykegai/mevshield @ development, so a change is
# only deployable after it reaches that repo too. This script makes the
# double push one step and refuses the two pushes that would be mistakes:
# running on main, and pushing any other branch without a confirmation.

set -euo pipefail

branch="$(git rev-parse --abbrev-ref HEAD)"

if [ "$branch" = "main" ]; then
  echo "Refusing to push main. Mirror main from origin: git push eykegai refs/remotes/origin/main:refs/heads/main" >&2
  exit 1
fi

for remote in origin eykegai; do
  if ! git remote get-url "$remote" >/dev/null 2>&1; then
    echo "Missing remote '$remote'. Add it first." >&2
    exit 1
  fi
done

if [ "$branch" != "feature/sepolia-fork-demo" ] && [ "${1:-}" != "--yes" ]; then
  read -r -p "Push $branch to origin, and to eykegai as development (deploys staging)? [y/N] " answer
  case "$answer" in
    y|Y) ;;
    *) echo "Aborted." >&2; exit 1 ;;
  esac
fi

git push origin "HEAD:$branch"
git push eykegai "HEAD:development"

echo "Pushed $branch to origin and to eykegai as development."
