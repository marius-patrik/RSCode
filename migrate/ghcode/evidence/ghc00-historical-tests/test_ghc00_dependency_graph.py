"""Read-only GHCode dependency-graph evidence inventory for GHC-00.

Run: python3 -m unittest .github/tests/test_ghc00_dependency_graph.py -v
Prints a compact JSON graph, SCC cycles, and per-module direct imports.
Never reads credentials, browser storage, or external repositories.
"""

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
MODULES = {path.relative_to(ROOT).as_posix(): path for path in SRC.rglob("*")
           if path.suffix in {".ts", ".tsx"}}
IMPORT_PATTERN = re.compile(r"""(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']""")


def resolve(source: str, name: str) -> str | None:
    if name.startswith("@/"):
        stem = Path("src") / name[2:]
    elif name.startswith("."):
        stem = Path(source).parent / name
    else:
        return None
    parts = []
    for part in stem.parts:
        if part == "..":
            if parts:
                parts.pop()
        elif part != ".":
            parts.append(part)
    candidate = "/".join(parts)
    return next((path for path in (candidate, candidate + ".ts", candidate + ".tsx",
                                 candidate + "/index.ts", candidate + "/index.tsx")
                 if path in MODULES), None)


def graph() -> dict[str, list[str]]:
    result = {}
    for name, path in sorted(MODULES.items()):
        contents = path.read_text(encoding="utf-8")
        imports = []
        for entry in IMPORT_PATTERN.findall(contents):
            destination = resolve(name, entry)
            if destination is not None:
                imports.append(destination)
        result[name] = sorted(set(imports))
    return result


def cycles(adjacency: dict[str, list[str]]) -> list[list[str]]:
    # Tarjan strongly connected components: reports each distinct cyclic group.
    index = 0
    stack = []
    active = set()
    sequence = {}
    low = {}
    groups = []

    def visit(node: str) -> None:
        nonlocal index
        sequence[node] = low[node] = index
        index += 1
        stack.append(node)
        active.add(node)
        for nxt in adjacency[node]:
            if nxt not in sequence:
                visit(nxt)
                low[node] = min(low[node], low[nxt])
            elif nxt in active:
                low[node] = min(low[node], sequence[nxt])
        if low[node] == sequence[node]:
            group = []
            while True:
                nxt = stack.pop()
                active.remove(nxt)
                group.append(nxt)
                if nxt == node:
                    break
            if len(group) > 1 or node in adjacency[node]:
                groups.append(sorted(group))

    for name in sorted(adjacency):
        if name not in sequence:
            visit(name)
    return sorted(groups)


class DependencyGraphEvidence(unittest.TestCase):
    def test_capture_actual_import_graph_without_modifying_sources(self) -> None:
        adjacency = graph()
        inventory = {
            "sourceModules": len(adjacency),
            "directInternalImportEdges": sum(map(len, adjacency.values())),
            "stronglyConnectedCycles": cycles(adjacency),
            "adjacency": adjacency,
        }
        print("\nGHC00_DEPENDENCY_EVIDENCE=" + json.dumps(inventory, sort_keys=True))
        self.assertIn("src/workspace/context.tsx", adjacency)
        self.assertIn("src/workbench/shell.tsx", adjacency)
        self.assertIn("src/workspace/storage.ts", adjacency)


if __name__ == "__main__":
    unittest.main()
