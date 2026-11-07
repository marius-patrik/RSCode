#!/usr/bin/env python3
"""Fail-closed, source-only migration integrity and ancestry verifier (stdlib)."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "migrate" / "manifest.json"
ALLOWED_NEW_PREFIXES = ("migrate/", "docs/migrations/")
ALLOWED_ADDITIONS = (
    "bunfig.toml", ".github/workflows/migration-source-verification.yml",
    ".github/workflows/migration-native-distribution.yml", ".github/workflows/release.yml",
    "biome.json", ".github/workflows/darkfactory-control.yml",
)
EXPECTED_BIOME_BLOB = "d55c587aabb0b3a3f9155c93631d0b7b6da71e50"
EXPECTED_MANAGED_WORKFLOW_BLOB = "c32497c5a8c1a40a7e1ece28f7f1ec61cb30a29a"
EXPECTED_BUNFIG = """# Source reconciliation adds inert nested applications under migrate/.
# Preserve root Bun test discovery without executing their independent suites.
[test]
pathIgnorePatterns = ["migrate/**"]
"""
MIN_FILES = {"rscode": 50, "ghcode": 90, "canvas": 45}


def git(*args: str, cwd: Path = ROOT, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True, check=check)


def require(condition: bool, label: str, errors: list[str]) -> None:
    print(("PASS" if condition else "FAIL") + " " + label)
    if not condition:
        errors.append(label)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", type=Path, help="Optional independent Git bundle for offline restoration")
    parser.add_argument("--bundle-sha256", help="Expected SHA-256 of the supplied private Git bundle")
    args = parser.parse_args()
    if args.bundle_sha256 and not args.bundle:
        parser.error("--bundle-sha256 requires --bundle")
    errors: list[str] = []
    m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    root_baseline = m["rootBaseline"]["commit"]
    history_parent = m["historyOnlyMergeParent"]
    bootstrap = m["historyOnlyImportCommit"]
    parents = git("rev-list", "--parents", "-n", "1", bootstrap).stdout.strip().split()
    bootstrap_is_ancestor = git("merge-base", "--is-ancestor", bootstrap, "HEAD", check=False).returncode == 0
    require(bootstrap_is_ancestor and parents == [bootstrap, root_baseline, history_parent],
            "preservation bootstrap has exact main+history parents and is an ancestor of HEAD", errors)

    changes = git("diff", "--name-only", root_baseline, "HEAD").stdout.splitlines()
    require(bool(changes) and all(p.startswith(ALLOWED_NEW_PREFIXES) or p in ALLOWED_ADDITIONS for p in changes),
            "migration source and explicit release-safety-only diff; root runtime unchanged", errors)
    require((ROOT / "bunfig.toml").read_text(encoding="utf-8") == EXPECTED_BUNFIG,
            "only permitted root config change isolates migrated tests", errors)
    migration_workflow = (ROOT / ".github/workflows/migration-source-verification.yml").read_text(encoding="utf-8")
    require("pull_request:" in migration_workflow and "permissions:\n  contents: read" in migration_workflow
            and not re.search(r"(?m)^\s*(?:push|workflow_dispatch|pages|id-token):\s*", migration_workflow)
            and all(f"  {job}:" in migration_workflow
                    for job in ("history-and-isolation", "rscode", "ghcode", "canvas")),
            "source verifier is PR-only, read-only and covers all three sources", errors)
    native_workflow = (ROOT / ".github/workflows/migration-native-distribution.yml").read_text(encoding="utf-8")
    require("pull_request:" in native_workflow and "permissions:\n  contents: read" in native_workflow
            and "\"migrate/rscode/**\"" in native_workflow
            and not re.search(r"(?m)^\s*(?:push|workflow_dispatch|pages|id-token):\s*", native_workflow)
            and not re.search(r"(?im)\b(?:gh release|npm publish|bun publish|deploy-pages)\b", native_workflow),
            "native acceptance workflow stays PR-only, read-only and nonpublishing", errors)
    original_release = git("show", f"{root_baseline}:.github/workflows/release.yml").stdout
    expected_release = original_release.replace(
        "  push:\n    branches: [main]\n",
        '  push:\n    branches: [main]\n    # Inert migrate/ and provenance-only merges MUST NOT publish application releases.\n'
        '    paths:\n      - "src/**"\n      - "scripts/**"\n      - "package.json"\n'
        '      - "bun.lock"\n      - "rsbuild.config.ts"\n      - "tsconfig.json"\n'
        '      - "docs/RELEASE_NOTES.md"\n', 1)
    require((ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8") == expected_release,
            "main release workflow changes only to active-app path-gated pushes", errors)
    require(git("rev-parse", "HEAD:biome.json").stdout.strip() == EXPECTED_BIOME_BLOB,
            "root Biome config exclusively ignores inert migrate directory", errors)
    require(git("rev-parse", "HEAD:.github/workflows/darkfactory-control.yml").stdout.strip()
            == EXPECTED_MANAGED_WORKFLOW_BLOB,
            "managed root CI retains root jobs; migratory nested matrix dispatch excluded", errors)
    require(not any(p.startswith(".github/workflows/") and p not in ALLOWED_ADDITIONS for p in changes),
            "no root workflow changes beyond PR-only source/native verification and release push guard", errors)

    for name, minimum in MIN_FILES.items():
        base = "migrate/" + name
        expected = m["sourceSnapshots"][name]["snapshotTreeSHA"]
        actual = git("rev-parse", f"HEAD:{base}").stdout.strip()
        require(expected == actual, f"{base} Git tree SHA matches manifest: {actual}", errors)
        paths = git("ls-tree", "-r", "--name-only", "HEAD", base).stdout.splitlines()
        require(len(paths) >= minimum, f"{base} full-tree file floor {minimum} (actual {len(paths)})", errors)

    for source, info in m["sourceHistory"].items():
        if not isinstance(info, dict) or "refs" not in info:
            continue
        refs = info["refs"]
        require(len(refs) == info["counts"]["refs"],
                f"{source} original branch/PR/tag mapping count", errors)
        missing = []
        unreachable = []
        for ref in refs:
            commit = ref["commit"]
            if git("cat-file", "-e", f"{commit}^{{commit}}", check=False).returncode != 0:
                missing.append((ref["ref"], commit))
            elif git("merge-base", "--is-ancestor", commit, "HEAD", check=False).returncode != 0:
                unreachable.append((ref["ref"], commit))
        require(not missing and not unreachable,
                f"{source} all {len(refs)} original Git commit tips ancestors of HEAD"
                + (f" (missing={missing[:4]}, unreachable={unreachable[:4]})" if missing or unreachable else ""),
                errors)

    allpaths = git("ls-tree", "-r", "--name-only", "HEAD", "migrate").stdout.splitlines()
    secret = re.compile(r"(^|/)(?:\.env(?:\.[^/]+)?|id_rsa|credentials\.json|secrets?\.json)$", re.I)
    forbidden = [p for p in allpaths if "/node_modules/" in p or "/.git/" in p
                 or "/dist/" in p or "/out/" in p
                 or (secret.search(p) and not p.endswith((".example", ".sample", ".template")))]
    require(not forbidden, f"migration excludes generated caches and suspicious secret filenames: {forbidden[:8]}", errors)

    for name in ("ghcode", "canvas"):
        require((ROOT / "migrate" / name / "LICENSE").is_file(),
                f"{name} source GPL license preserved", errors)

    for required in (
        "migrate/rscode/src/server/browserService.ts",
        "migrate/rscode/src/tests/runtimeSecurity.test.ts",
        "migrate/rscode/scripts/distribution/build.ts",
        "migrate/ghcode/src/app.tsx",
        "migrate/ghcode/.github/tests/identity-isolation.spec.ts",
        "migrate/ghcode/evidence/ghc00-historical-tests/ghc00-integrity.spec.ts",
        "migrate/canvas/.github/app/src/main.tsx",
        "migrate/canvas/.github/app/src/persistence/indexeddb.ts",
        "migrate/canvas/.github/tests/persistence/canvas-persistence.mjs",
    ):
        require((ROOT / required).is_file(), f"required source fixture {required}", errors)

    if args.bundle:
        bundle = args.bundle.expanduser().resolve()
        require(bundle.is_file(), f"backup bundle exists {bundle}", errors)
        if bundle.is_file():
            if args.bundle_sha256:
                digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
                require(digest == args.bundle_sha256.lower(), f"backup Git bundle SHA-256 matches {digest}", errors)
            check_bundle = subprocess.run(["git", "bundle", "verify", str(bundle)],
                                          cwd=ROOT, text=True, capture_output=True)
            require(check_bundle.returncode == 0,
                    f"git bundle verify: {check_bundle.stderr[:200]}", errors)
            with tempfile.TemporaryDirectory(prefix="tri-source-restore-") as temp:
                # Cloning the bundle creates an isolated object database; no remote network is required.
                restored = Path(temp) / "restore"
                clone = git("clone", "--no-checkout", str(bundle), str(restored), check=False)
                require(clone.returncode == 0, f"offline bundle clone: {clone.stderr[:240]}", errors)
                if clone.returncode == 0:
                    tips = {r["commit"] for source in m["sourceHistory"].values()
                            if isinstance(source, dict) and "refs" in source for r in source["refs"]}
                    absent = [sha for sha in sorted(tips)
                              if git("cat-file", "-e", f"{sha}^{{commit}}",
                                     cwd=restored, check=False).returncode != 0]
                    require(not absent, f"offline restoration covers all {len(tips)} source tips", errors)
                    fsck = git("fsck", "--connectivity-only", cwd=restored, check=False)
                    require(fsck.returncode == 0, "offline restored Git fsck connectivity", errors)
    else:
        print("NOT RUN offline Git bundle restoration (pass --bundle /path/to/backup.bundle)")
    print(json.dumps({"status": "FAIL" if errors else "PASS", "errors": errors,
                      "productionChanged": False if not errors else None,
                      "sourceExecution": "NOT RUN BY PYTHON VERIFIER (see CI per-track evidence)",
                      "independentBackupRestore": "TESTED" if args.bundle else "NOT_RUN"}, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
