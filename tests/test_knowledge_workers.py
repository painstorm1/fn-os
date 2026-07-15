import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, relative: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


knowledge_worker = load_module("fnos_knowledge_action_worker", "tools/fnos_knowledge_action_worker.py")
daily_worker = load_module("fnos_knowledge_daily_worker", "tools/fnos_knowledge_daily_worker.py")
product_worker = load_module("fnos_product_card_worker", "tools/fnos_product_card_worker.py")


class KnowledgeWorkerPathTests(unittest.TestCase):
    def test_windows_unc_colon_and_traversal_are_rejected(self):
        for value in (
            "../secret.md",
            "C:/secret.md",
            "C:secret.md",
            r"\\server\share\secret.md",
            "folder/name:secret.md",
            "folder/../../secret.md",
            r"folder\..\secret.md",
            "folder//secret.md",
            "folder/nul\0secret.md",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                knowledge_worker.safe_relative_path(value)
        with self.assertRaises(ValueError):
            knowledge_worker.safe_relative_path("99_PRIVATE/secret.md", card=True)
        self.assertEqual(
            knowledge_worker.safe_relative_path(
                "03_INBOX/Resource_Triage_Cards/2026-07-16/card.md", card=True
            ).as_posix(),
            "03_INBOX/Resource_Triage_Cards/2026-07-16/card.md",
        )

    def test_resolved_symlink_cannot_escape_vault(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "vault"
            outside = Path(directory) / "outside.md"
            card_dir = root / "03_INBOX" / "Resource_Triage_Cards"
            card_dir.mkdir(parents=True)
            outside.write_text("private", encoding="utf-8")
            link = card_dir / "link.md"
            try:
                link.symlink_to(outside)
            except OSError:
                with self.assertRaises(ValueError):
                    knowledge_worker.resolve_inside(
                        root, knowledge_worker.PurePosixPath("../outside.md")
                    )
                return
            relative = knowledge_worker.safe_relative_path(
                "03_INBOX/Resource_Triage_Cards/link.md", card=True
            )
            with self.assertRaises(ValueError):
                knowledge_worker.resolve_inside(root, relative)


class ProductWorkerImageRootTests(unittest.TestCase):
    def test_product_card_target_rejects_colon_and_traversal(self):
        for value in (
            "50_BUSINESS_KNOWLEDGE/Products/Cards/C:/secret.md",
            "50_BUSINESS_KNOWLEDGE/Products/Cards/../secret.md",
            r"50_BUSINESS_KNOWLEDGE\Products\Cards\\server\share.md",
            "50_BUSINESS_KNOWLEDGE/Products/Cards/nul\0secret.md",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                product_worker.ensure_target(value)

    def test_private_vault_and_legacy_broad_root_are_rejected_by_default(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory) / "vault"
            image_root = vault / "90_RESOURCES" / "Product_Images"
            private_image = vault / "99_PRIVATE" / "private.png"
            allowed_image = image_root / "incoming" / "allowed.png"
            private_image.parent.mkdir(parents=True)
            allowed_image.parent.mkdir(parents=True)
            private_image.write_bytes(b"private")
            allowed_image.write_bytes(b"allowed")
            with (
                mock.patch.object(product_worker, "VAULT", vault.resolve()),
                mock.patch.object(product_worker, "IMAGE_ROOT", image_root.resolve()),
                mock.patch.dict(
                    os.environ,
                    {"FNOS_PRODUCT_IMAGE_ROOTS": str(vault)},
                    clear=False,
                ),
            ):
                os.environ.pop("FNOS_ALLOWED_PRODUCT_IMAGE_ROOTS", None)
                with self.assertRaisesRegex(ValueError, "outside the allowed roots"):
                    product_worker.copy_image(str(private_image), "FN001", True)
                relative, kind = product_worker.copy_image(str(allowed_image), "FN001", True)
                self.assertEqual(kind, "vault")
                self.assertTrue(relative.startswith("90_RESOURCES/Product_Images/FN001/"))

    def test_extra_image_root_requires_explicit_allowlist_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory) / "vault"
            image_root = vault / "90_RESOURCES" / "Product_Images"
            extra_root = Path(directory) / "approved"
            image = extra_root / "approved.png"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"approved")
            with (
                mock.patch.object(product_worker, "VAULT", vault.resolve()),
                mock.patch.object(product_worker, "IMAGE_ROOT", image_root.resolve()),
                mock.patch.dict(
                    os.environ,
                    {"FNOS_ALLOWED_PRODUCT_IMAGE_ROOTS": str(extra_root)},
                    clear=False,
                ),
            ):
                relative, kind = product_worker.copy_image(str(image), "FN002", True)
                self.assertEqual(kind, "vault")
                self.assertTrue(relative.startswith("90_RESOURCES/Product_Images/FN002/"))


class DailyCaptureWorkerTests(unittest.TestCase):
    def test_fixture_write_readback_and_dry_run_use_fixed_path(self):
        payload = {
            "daily_id": "daily-1",
            "entry_date": "2026-07-16",
            "title": "오늘 제목",
            "entry_preview": "줄 1\n줄 2 원문",
            "target_path": "03_INBOX/Daily_Inbox/2026-07-16/FNOS-daily-1.md",
        }
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory) / "vault"
            dry_receipt = daily_worker.process(payload, vault, dry_run=True)
            target = vault / payload["target_path"]
            self.assertTrue(dry_receipt["readback_verified"])
            self.assertFalse(target.exists())
            receipt = daily_worker.process(payload, vault, dry_run=False)
            self.assertTrue(receipt["readback_verified"])
            self.assertEqual(receipt["target_path"], payload["target_path"])
            self.assertEqual(target.read_text(encoding="utf-8"), "# 오늘 제목\n\n줄 1\n줄 2 원문\n")

    def test_daily_target_mismatch_and_nul_are_rejected(self):
        base = {
            "daily_id": "daily-1",
            "entry_date": "2026-07-16",
            "title": "제목",
            "entry_preview": "원문",
        }
        for target in (
            "03_INBOX/Daily_Inbox/2026-07-16/other.md",
            "03_INBOX/Daily_Inbox/2026-07-16/FNOS-daily-1\0.md",
        ):
            with self.subTest(target=target), self.assertRaises(ValueError):
                daily_worker.process({**base, "target_path": target}, Path("vault"), dry_run=True)


class ProductWorkerAtomicWriteTests(unittest.TestCase):
    def product_environment(self, directory: str):
        vault = Path(directory) / "vault"
        cards = vault / "50_BUSINESS_KNOWLEDGE" / "Products" / "Cards"
        image_root = vault / "90_RESOURCES" / "Product_Images"
        index = vault / "50_BUSINESS_KNOWLEDGE" / "Products" / "Product_Index.md"
        payload = {
            "target_path": "50_BUSINESS_KNOWLEDGE/Products/Cards/FN001_제품.md",
            "product": {"id": "product-1", "product_code": "FN001", "product_name": "제품"},
            "import_links": [],
            "import_products": [],
            "sales_mappings": [],
        }
        patches = (
            mock.patch.object(product_worker, "VAULT", vault.resolve()),
            mock.patch.object(product_worker, "CARDS_ROOT", cards.resolve()),
            mock.patch.object(product_worker, "IMAGE_ROOT", image_root.resolve()),
            mock.patch.object(product_worker, "INDEX_PATH", index.resolve()),
        )
        return vault, cards, index, payload, patches

    def test_card_and_index_are_atomic_locked_and_manual_tail_survives(self):
        with tempfile.TemporaryDirectory() as directory:
            _vault, cards, index, payload, patches = self.product_environment(directory)
            target = cards / "FN001_제품.md"
            target.parent.mkdir(parents=True)
            target.write_text("old auto\n<!-- AUTO_PRODUCT_CARD_END -->\n## 사용자 메모\n보존", encoding="utf-8")
            with patches[0], patches[1], patches[2], patches[3]:
                receipt = product_worker.process(payload, False)
            self.assertTrue(receipt["readback_verified"])
            self.assertIn("## 사용자 메모\n보존", target.read_text(encoding="utf-8"))
            self.assertTrue(index.is_file())
            self.assertFalse(target.with_name(target.name + ".lock").exists())
            self.assertFalse(index.with_name(index.name + ".lock").exists())
            self.assertEqual(list(target.parent.glob("*.tmp")), [])

    def test_existing_lock_and_midflight_conflict_preserve_card(self):
        with tempfile.TemporaryDirectory() as directory:
            _vault, cards, _index, payload, patches = self.product_environment(directory)
            target = cards / "FN001_제품.md"
            target.parent.mkdir(parents=True)
            original = "external user content"
            target.write_text(original, encoding="utf-8")
            lock = target.with_name(target.name + ".lock")
            lock.write_text("other", encoding="ascii")
            with patches[0], patches[1], patches[2], patches[3], self.assertRaisesRegex(RuntimeError, "locked"):
                product_worker.process(payload, False)
            self.assertEqual(target.read_text(encoding="utf-8"), original)
            lock.unlink()

            actual_state = product_worker.file_state(target)
            changed_state = (actual_state[0], actual_state[1], "changed-hash")
            with (
                patches[0], patches[1], patches[2], patches[3],
                mock.patch.object(product_worker, "file_state", side_effect=[actual_state, changed_state]),
                self.assertRaisesRegex(RuntimeError, "changed during update"),
            ):
                product_worker.process(payload, False)
            self.assertEqual(target.read_text(encoding="utf-8"), original)
            self.assertFalse(lock.exists())
            self.assertEqual(list(target.parent.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
