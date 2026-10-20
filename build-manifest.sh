#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd -- "$script_dir"
mkdir -p pages

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

function collect(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect(entryPath);
    return entry.name.toLowerCase().endsWith(".png") ? [entryPath.replaceAll(path.sep, "/")] : [];
  });
}

const files = collect("pages").sort().map((file) => file.replace(/^pages\//, ""));
fs.writeFileSync("manifest.json", `${JSON.stringify({ files }, null, 2)}\n`);
NODE
