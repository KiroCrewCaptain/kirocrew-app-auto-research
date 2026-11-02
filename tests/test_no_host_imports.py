"""Only the two host shims reach Kiro Crew, and only through ``importlib``.

The gateway's public surface for an app is the ``AppContext`` its hooks get and
the structural route records the registry accepts. Research Lab also drives
gateway services no App Kit seam provides yet (the AutoNudge loops, the
artifact store, the knowledge library's LLM pool; see PORTING.md), and prefers
the gateway's own owner-only file helpers to its restatements. Those are
resolved from the running gateway in ``backend/_host.py`` (services) and
``backend/_fs.py`` (file helpers) alone, by name through ``importlib`` (a few
constants and classes when ``_host.py`` loads, the rest at call time), so a
missing one refuses or degrades the operation instead of breaking the module load. No other
backend module may import ``kiro_crew`` in any form or name one of its modules,
and neither shim has a top-level ``kiro_crew`` import.
"""

from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
_SHIMS = ("_host.py", "_fs.py")


def _host_imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found += [a.name for a in node.names if a.name.split(".")[0] == "kiro_crew"]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if node.module.split(".")[0] == "kiro_crew":
                found.append(node.module)
        elif isinstance(node, ast.Call):
            # importlib.import_module("kiro_crew...") / __import__("kiro_crew...")
            name = getattr(node.func, "attr", None) or getattr(node.func, "id", None)
            if name in {"import_module", "__import__"} and node.args:
                arg = node.args[0]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    if arg.value.split(".")[0] == "kiro_crew":
                        found.append(arg.value)
    return found


def _host_strings(path: Path) -> list[str]:
    """String literals naming a ``kiro_crew`` module (what ``_host_attr`` is handed)."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and re.fullmatch(r"kiro_crew(\.[a-z_]+)*", node.value)
    ]


class TestNoHostImports(unittest.TestCase):
    def test_no_backend_module_but_the_host_shim_reaches_kiro_crew(self) -> None:
        files = sorted(BACKEND.rglob("*.py"))
        self.assertTrue(files, "no backend modules found")
        for path in files:
            if path.name in _SHIMS:
                continue
            with self.subTest(module=path.relative_to(BACKEND.parent).as_posix()):
                self.assertEqual(_host_imports(path), [])
                self.assertEqual(_host_strings(path), [])

    def test_the_host_shims_import_kiro_crew_only_at_call_time(self) -> None:
        for shim in _SHIMS:
            with self.subTest(shim=shim):
                tree = ast.parse((BACKEND / shim).read_text(encoding="utf-8"))
                for node in tree.body:
                    if isinstance(node, (ast.Import, ast.ImportFrom)):
                        names = (
                            [a.name for a in node.names]
                            if isinstance(node, ast.Import)
                            else [node.module or ""]
                        )
                        self.assertFalse(any(n.split(".")[0] == "kiro_crew" for n in names), names)
                self.assertEqual(_host_imports(BACKEND / shim), [])

    def test_only_the_service_shim_calls_the_resolver(self) -> None:
        """``_fs`` goes through ``_host._host_attr``: one resolver, one seam to fake."""
        source = (BACKEND / "_fs.py").read_text(encoding="utf-8")
        self.assertNotIn("import_module", source)
        self.assertIn("_host._host_attr", source)

    def test_the_scan_sees_each_import_form(self) -> None:
        """The detector itself: every spelling it must catch is caught."""
        import tempfile

        source = (
            "import kiro_crew\n"
            "import kiro_crew.apps as a\n"
            "from kiro_crew.executors import run_in_embed_pool\n"
            "import importlib\n"
            "importlib.import_module('kiro_crew.embeddings')\n"
            "__import__('kiro_crew')\n"
            "from . import kiro_crew_like\n"
            "import kiro_crewish\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "probe.py"
            path.write_text(source, encoding="utf-8")
            self.assertEqual(
                _host_imports(path),
                [
                    "kiro_crew",
                    "kiro_crew.apps",
                    "kiro_crew.executors",
                    "kiro_crew.embeddings",
                    "kiro_crew",
                ],
            )


if __name__ == "__main__":
    unittest.main()
