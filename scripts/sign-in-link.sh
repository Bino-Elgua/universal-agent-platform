#!/usr/bin/env bash
# Compatibility wrapper. Run from the repository, or set ENV_FILE explicitly.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node --env-file="${ENV_FILE:-.env}" "$script_dir/sign-in-link.mjs" "${1:?usage: sign-in-link.sh <owner-email>}"
