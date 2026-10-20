import os
import unittest
from unittest.mock import patch

from app.processor import process_task
from app.security import has_valid_internal_key


class ProcessorContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_image_worker_contract_is_disabled_and_idempotent(self):
        result = await process_task("task-1234", "IMAGE_GENERATION", {"prompt": "Ảnh trang sức nền xám"}, "dedupe-1234")
        contract = result["imageWorker"]
        self.assertEqual(contract["provider"], "disabled")
        self.assertEqual(contract["idempotencyKey"], "dedupe-1234")
        self.assertIsNone(contract["outputAssetUrl"])
        self.assertEqual(result["sideEffects"], "none")

    async def test_publication_proposals_always_require_approval_and_do_not_publish(self):
        result = await process_task("task-5678", "PRODUCT_PUBLICATION_PROPOSAL", {"prompt": "Đề xuất xuất bản"})
        self.assertTrue(result["approvalRequired"])
        self.assertEqual(result["sideEffects"], "none")
        self.assertIsNone(result["proposal"])

    async def test_content_task_does_not_call_a_provider_or_mutate_commerce(self):
        # Keep this contract test isolated even when Compose injects a real provider key.
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            result = await process_task("task-9012", "CONTENT_DRAFT", {"prompt": "Viết giới thiệu"})
        self.assertFalse(result["providerConfigured"])
        self.assertIsNone(result["draft"])
        self.assertEqual(result["sideEffects"], "none")

    async def test_unknown_task_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "UNSUPPORTED_TASK_TYPE"):
            await process_task("task-0000", "DELETE_ORDER", {})

    def test_internal_service_key_requires_a_long_constant_time_match(self):
        secret = "a-random-internal-key-with-more-than-32-characters"
        self.assertTrue(has_valid_internal_key(secret, secret))
        self.assertFalse(has_valid_internal_key("short", "short"))
        self.assertFalse(has_valid_internal_key(secret, "wrong-key"))
        self.assertFalse(has_valid_internal_key(secret, ""))


if __name__ == "__main__":
    unittest.main()
