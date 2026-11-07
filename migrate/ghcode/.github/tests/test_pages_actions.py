"""Behavioral verification of GitHub Pages Actions production delivery."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]

class PagesActionsTests(unittest.TestCase):
    def test_deploy_without_staging_branches_or_shared_origin_previews(self):
        ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertIn("actions/upload-pages-artifact@v3", ci)
        self.assertIn("actions/deploy-pages@v4", ci)
        self.assertIn("needs: build-site", ci)
        self.assertIn("needs: deploy-pages", ci)
        self.assertIn("test -d dist/static", ci)
        self.assertIn("test -d dist/static/js", ci)
        self.assertIn("test -d dist/static/css", ci)
        self.assertNotIn("test -d dist/assets", ci)
        self.assertNotIn("git push origin HEAD:gh-pages", ci)
        self.assertFalse((ROOT / ".github/workflows/pr-preview.yml").exists())


    def test_release_cannot_delete_arbitrary_work_branches(self):
        ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertNotIn("cleanup-branches:", ci)
        self.assertNotIn("gh api --method DELETE", ci)
        self.assertNotIn("git push origin HEAD:gh-pages", ci)

    def test_release_is_blocked_until_deployment_passes(self):
        ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        release = ci.split("  release:", 1)[1]
        self.assertIn("needs: deploy-pages", release)
        self.assertIn("gh release create", release)
        self.assertIn("git rev-list -n 1", release)

if __name__ == "__main__":
    unittest.main()
