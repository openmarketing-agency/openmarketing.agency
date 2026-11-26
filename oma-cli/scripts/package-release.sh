#!/bin/bash
set -euo pipefail
version=${1:?Pass the bare CLI version.}
output=${2:?Pass an output directory.}
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && $version == "$(bun -p 'require("./package.json").version')" ]] \
    || { printf 'The CLI release version must match package.json.\n' >&2; exit 1; }
[[ -x dist/oma ]] || { printf 'Build dist/oma before packaging.\n' >&2; exit 1; }
package="oma-cli-v$version-linux-amd64"
mkdir -p "$output"
output=$(CDPATH='' cd -- "$output" && pwd)
stage=$(mktemp -d "$output/.stage.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
printf '==> Packaging %s\n' "$package" >&2
mkdir "$stage/$package"
cp dist/oma LICENSE "$stage/$package/"
tar -C "$stage" -czf "$output/$package.tar.gz" "$package"
(cd "$output" && sha256sum "$package.tar.gz" > SHA256SUMS)
printf '==> CLI archive and checksum are ready\n' >&2
