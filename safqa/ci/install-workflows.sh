#!/usr/bin/env bash
# One-time: GitHub requires the `workflow` OAuth scope to add workflow files.
#   gh auth refresh -h github.com -s workflow     (approve the code in the browser)
#   bash safqa/ci/install-workflows.sh && git push
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
cp safqa/ci/workflows/safqa-*.yml .github/workflows/
git add .github/workflows/safqa-*.yml
git commit -m "ci: enable safqa-hunt, safqa-ci and safqa-upstream-sync workflows"
