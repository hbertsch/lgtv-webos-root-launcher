#!/bin/sh
# Builds dist/lgtv.blueprint.launcher_1.0.0_all.ipk from app/ and service/.
set -e
cd "$(dirname "$0")/.."
mkdir -p dist
ares-package --no-minify app service --outdir dist
