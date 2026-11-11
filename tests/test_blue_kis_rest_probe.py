import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "blue_kis_rest_probe.py"
spec = importlib.util.spec_from_file_location("blue_kis_rest_probe", SCRIPT)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class KISProbeTest(unittest.TestCase):
    def test_parse_quote(self):
        response = {
            "rt_cd": "0",
            "output": {
                "stck_prpr": "70000", "acml_vol": "12345",
                "stck_oprc": "69000", "stck_hgpr": "71000", "stck_lwpr": "68000",
            },
        }
        row = probe.parse_quote("005930", "삼성전자", response, "req", "res")
        self.assertEqual(row["current_price"], 70000)
        self.assertEqual(row["accumulated_volume"], 12345)
        self.assertFalse(row["quote_exchange_timestamp_verified"])
        self.assertEqual(row["market"], "KRX")

    def test_rejects_invalid_response(self):
        with self.assertRaisesRegex(probe.ProbeFailure, "QUOTE_REJECTED"):
            probe.parse_quote("005930", "삼성전자", {"rt_cd": "1", "msg_cd": "BAD"}, "req", "res")

    def test_token_not_exposed_in_quote(self):
        token = "NEVER_LOG_OR_WRITE_THIS_TOKEN"
        result = {"rt_cd": "0", "output": {"stck_prpr": "100", "acml_vol": "1"}}
        with patch.object(probe, "_request_json", return_value=result) as fake:
            row = probe.get_quote("APPKEY", "APPSECRET", token, "005930", "삼성전자")
        self.assertNotIn(token, str(row))
        self.assertNotIn("APPSECRET", str(row))
        self.assertEqual(fake.call_args.kwargs["params"]["FID_COND_MRKT_DIV_CODE"], "J")
        self.assertEqual(fake.call_args.args[1], "/uapi/domestic-stock/v1/quotations/inquire-price")

    def test_error_code_is_allowlisted(self):
        self.assertEqual(probe.safe_code("abc-123"), "abc-123")
        self.assertEqual(probe.safe_code("SECRET:\nabcdef"), "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
