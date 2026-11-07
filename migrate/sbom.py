#!/usr/bin/env python3
"""Reproducible CycloneDX 1.6 dependency inventory from an exact Bun lockfile.

Usage: python3 migrate/sbom.py <source/bun.lock> <source/node_modules>
Read-only: writes JSON to stdout. Installed package metadata is evidence, not
proof of distribution rights. Missing/ambiguous declarations are explicit.
"""
from __future__ import annotations

import base64
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote


def parse_jsonc(raw: str):
    # Bun's text bun.lock uses trailing commas; never delete commas in strings.
    out = []
    quoted = False
    escaped = False
    i = 0
    while i < len(raw):
        char = raw[i]
        if quoted:
            out.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
            out.append(char)
        elif char == ',':
            end = i + 1
            while end < len(raw) and raw[end].isspace():
                end += 1
            if end >= len(raw) or raw[end] not in '}]':
                out.append(char)
        else:
            out.append(char)
        i += 1
    return json.loads("".join(out))


def versioned(locator: str, key: str):
    if isinstance(locator, str) and "@" in locator:
        name, version = locator.rsplit("@", 1)
        if name and version and "://" not in name:
            return name, version
    return key, None


def license_declarations(data: object):
    if not isinstance(data, dict):
        return []
    raw = data.get("license", data.get("licenses"))
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, dict):
        return [raw.get("type")] if isinstance(raw.get("type"), str) else []
    if isinstance(raw, list):
        return [v for item in raw for v in (
            [item] if isinstance(item, str) else
            [item["type"]] if isinstance(item, dict) and isinstance(item.get("type"), str) else []
        )]
    return []


def read_installed_package(node_modules: Path, name: str, version: str | None):
    # Refuse to attach a declaration from an unrelated hoisted version.
    candidate = node_modules.joinpath(*name.split("/"), "package.json")
    try:
        package = json.loads(candidate.read_text(encoding="utf8"))
        return package if isinstance(package, dict) and package.get("version") == version else None
    except (OSError, ValueError):
        return None


def inventory(lock_path: Path, node_modules: Path) -> dict:
    raw = lock_path.read_text(encoding="utf8")
    lock = parse_jsonc(raw)
    if not isinstance(lock, dict) or not isinstance(lock.get("packages"), dict):
        raise ValueError("Bun dependency lock is malformed or unsupported")
    pkg_entries = lock["packages"]
    packages = {}
    aliases = defaultdict(list)
    by_name = defaultdict(list)
    for key, entry in sorted(pkg_entries.items()):
        if not isinstance(key, str) or not isinstance(entry, list) or not entry:
            raise ValueError("Malformed Bun resolved-package entry")
        name, version = versioned(entry[0], key)
        if not version:
            raise ValueError("Cannot determine exact locked version for " + key)
        ref = "pkg:npm/" + quote(name, safe="/") + "@" + quote(version, safe=".")
        if ref in packages:
            # Bun can lock the same exact artifact in both the root and a
            # nested platform dependency. Preserve both lock paths, but do
            # not invent duplicate SBOM components for identical content.
            prior = packages[ref][3]
            if prior[3:] != entry[3:] or prior[1] != entry[1]:
                raise ValueError("Conflicting source/checksum for shared package identity: " + ref)
            aliases[ref].append(key)
            continue
        packages[ref] = (key, name, version, entry)
        by_name[name].append(ref)

    components = []
    relations = []
    for ref, (key, name, version, entry) in sorted(packages.items()):
        metadata = entry[2] if len(entry) > 2 and isinstance(entry[2], dict) else {}
        installed = read_installed_package(node_modules, name, version)
        license_strings = license_declarations(installed)
        props = [{"name": "darkfactory:bun-lock-key", "value": key}]
        for alias in sorted(aliases[ref]):
            props.append({"name": "darkfactory:bun-lock-alias", "value": alias})
        if not license_strings:
            props.append({"name": "darkfactory:missing-license-evidence", "value": "true"})
        if installed is None:
            props.append({"name": "darkfactory:package-metadata-unavailable", "value": "true"})
        component = {
            "type": "library", "name": name, "version": version,
            "bom-ref": ref, "purl": ref, "properties": props,
        }
        if license_strings:
            component["licenses"] = [{"license": {"name": value}} for value in license_strings]
        if len(entry) > 3 and isinstance(entry[3], str) and entry[3].startswith("sha512-"):
            try:
                digest = base64.b64decode(entry[3][7:], validate=True).hex()
                if len(digest) == 128:
                    component["hashes"] = [{"alg": "SHA-512", "content": digest}]
            except (ValueError, base64.binascii.Error):
                component["properties"].append({
                    "name": "darkfactory:invalid-package-integrity", "value": "true",
                })
        if len(entry) > 1 and isinstance(entry[1], str) and entry[1].startswith("https://"):
            component["externalReferences"] = [{
                "type": "distribution", "url": entry[1],
            }]
        targets = set()
        unresolved = []
        for field in ("dependencies", "optionalDependencies", "peerDependencies"):
            deps = metadata.get(field, {})
            if not isinstance(deps, dict):
                continue
            for dependency in deps:
                candidates = by_name.get(dependency, [])
                if len(candidates) == 1:
                    targets.add(candidates[0])
                else:
                    unresolved.append(field + ":" + dependency)
        if unresolved:
            component["properties"].append({
                "name": "darkfactory:unresolved-dependency-edges",
                "value": ",".join(sorted(unresolved)),
            })
        components.append(component)
        relations.append({"ref": ref, "dependsOn": sorted(targets)})

    source = lock_path.parent.name
    return {
        "bomFormat": "CycloneDX", "specVersion": "1.6", "version": 1,
        "metadata": {
            "component": {"type": "application", "name": source},
            "properties": [
                {"name": "darkfactory:lock-sha256",
                 "value": hashlib.sha256(raw.encode("utf8")).hexdigest()},
                {"name": "darkfactory:source-kind", "value": "Bun lockfile + installed package.json"},
                {"name": "darkfactory:license-completeness",
                 "value": "partial; absent platform packages and bundled assets unverified"},
            ],
        },
        "components": components,
        "dependencies": relations,
    }


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: sbom.py <bun.lock> <node_modules>")
    print(json.dumps(inventory(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))


if __name__ == "__main__":
    main()
