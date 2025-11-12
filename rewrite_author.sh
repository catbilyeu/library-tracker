#!/usr/bin/env bash
set -euo pipefail
N=""; NAME=""; EMAIL=""
start=e0d1a9ac99172c766440bb73a9a79e975c3b5b7d
GIT_AUTHOR_NAME="" GIT_AUTHOR_EMAIL="" GIT_COMMITTER_NAME="" GIT_COMMITTER_EMAIL=""   git filter-branch --env-filter export
