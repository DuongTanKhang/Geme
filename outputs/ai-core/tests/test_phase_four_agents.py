import unittest
from unittest.mock import patch

from app.phase_four_agents import (
    PhaseFourAgentError,
    generate_sales_answer,
    normalize_marketing_draft,
    normalize_sales_answer,
)


class PhaseFourAgentContractTests(unittest.TestCase):
    def test_sales_recommendations_and_citations_are_limited_to_live_sources(self):
        catalog = [{"id": "active-product"}]
        knowledge = [{"id": "active-policy", "content": "GEME hỗ trợ đổi sản phẩm."}]
        result = normalize_sales_answer({
            "answer": "Mẫu này đang có hàng.",
            "recommended_product_ids": ["active-product", "hidden-product"],
            "knowledge_source_ids": ["active-policy", "made-up-policy"],
            "needs_handoff": False,
        }, catalog, knowledge)
        self.assertEqual(result["recommended_product_ids"], ["active-product"])
        self.assertEqual(result["knowledge_source_ids"], ["active-policy"])

    def test_sensitive_unverified_claim_fails_closed_to_human_handoff(self):
        result = normalize_sales_answer({
            "answer": "Viên đá này tự nhiên và có chứng nhận quốc tế.",
            "recommended_product_ids": ["p1"],
            "knowledge_source_ids": [],
        }, [{"id": "p1"}], [])
        self.assertTrue(result["needs_handoff"])
        self.assertTrue(result["unresolved"])
        self.assertEqual(result["handoff_reason"], "UNVERIFIED_CLAIM")
        self.assertEqual(result["recommended_product_ids"], [])

    def test_empty_sources_returns_safe_handoff_without_provider_request(self):
        with patch("app.phase_four_agents._request_json") as provider:
            import asyncio
            result = asyncio.run(generate_sales_answer({"question": "Tư vấn giúp tôi", "catalog": [], "knowledge": []}))
        provider.assert_not_called()
        self.assertTrue(result["needs_handoff"])
        self.assertEqual(result["handoff_reason"], "NO_ACTIVE_SOURCES")

    def test_marketing_draft_keeps_only_requested_product_ids_and_bounds_tags(self):
        result = normalize_marketing_draft({
            "title": "Bộ sưu tập đá xanh",
            "caption": "Một sắc xanh dịu dàng.",
            "body": "",
            "hashtags": ["#GEME", "#GEME", "#TrangSuc"],
            "unsupported_claims": ["natural origin"],
        }, ["product-1"], "INSTAGRAM")
        self.assertEqual(result["source_product_ids"], ["product-1"])
        self.assertEqual(result["hashtags"], ["GEME", "TrangSuc"])
        self.assertIn("MODEL_FLAGGED_UNSUPPORTED_CLAIMS", result["fact_warnings"])
        self.assertEqual(result["channel"], "INSTAGRAM")

    def test_unsupported_marketing_channel_is_rejected(self):
        with self.assertRaises(PhaseFourAgentError):
            normalize_marketing_draft({}, ["p1"], "TIKTOK")


if __name__ == "__main__":
    unittest.main()
