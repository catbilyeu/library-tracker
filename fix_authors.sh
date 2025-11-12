#!/usr/bin/env bash
set -euo pipefail
export FILTER_BRANCH_SQUELCH_WARNING=1

git filter-branch -f --env-filter '
if [ "$GIT_AUTHOR_EMAIL" = "cat@users.noreply.github.com" ]; then
  export GIT_AUTHOR_NAME="catbilyeu";
  export GIT_AUTHOR_EMAIL="88844309+catbilyeu@users.noreply.github.com";
fi
if [ "$GIT_COMMITTER_EMAIL" = "cat@users.noreply.github.com" ]; then
  export GIT_COMMITTER_NAME="catbilyeu";
  export GIT_COMMITTER_EMAIL="88844309+catbilyeu@users.noreply.github.com";
fi
' -- --all
