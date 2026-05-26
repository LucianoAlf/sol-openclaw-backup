#!/usr/bin/env bash
set -euo pipefail

WORKDIR="/opt/sol-adm"
SSH_KEY="/opt/sol-adm/.ssh/backup_deploy_key"

export GIT_SSH_COMMAND="ssh -i ${SSH_KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Sol ADM Backup}"
export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-sol-adm@localhost}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-Sol ADM Backup}"
export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-sol-adm@localhost}"

cd "${WORKDIR}"

git remote get-url origin >/dev/null

git add -A

if git diff --cached --quiet; then
  echo "$(date -Is) - sem alteracoes para commit"
  exit 0
fi

git commit -m "backup: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push origin HEAD:main
