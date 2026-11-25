import json
import unittest
from tools.gateway_live_inspection import history,version_summary,summary_bindings,probe
V="12345678-1234-1234-1234-123456789abc"
GOOD={"type":"service","name":"BLUE_API","service":"blue-signal-lab-api-v2","entrypoint":"BlueWebGateway"}
class LiveInspectionTests(unittest.TestCase):
    def test_history_sorted_without_author_or_secret(self):
        a={"created_on":"2026-11-25T17:02:00Z","source":"wrangler","author_email":"secret@example.com","versions":[{"version_id":V,"percentage":100}]}
        b={**a,"created_on":"2026-11-25T17:03:00Z","source":"workersci"}
        out=history({"deployments":[a,b]})
        self.assertEqual(out[0]["source"],"workersci")
        self.assertNotIn("secret",json.dumps(out))
    def test_wrong_version_and_missing_deployment_rejected(self):
        with self.assertRaises(ValueError): version_summary("blue-signal-lab",{"id":"wrong"},V)
        with self.assertRaises(ValueError): history({"deployments":[]})
    def test_binding_summary_no_secrets(self):
        report=summary_bindings("blue-signal-lab-api-v2",[{"type":"plain_text","name":"BLUE_WEB_ACCESS_AUD","text":"sensitive-value"}])
        self.assertTrue(report["access_aud_present"])
        self.assertNotIn("sensitive-value",json.dumps(report))
        self.assertEqual(summary_bindings("blue-signal-lab",[GOOD])["gateway"],"EXACT")
        self.assertEqual(summary_bindings("blue-signal-lab",[])["gateway"],"ABSENT")
    def test_active_version_export_and_no_author(self):
        report=version_summary("blue-signal-lab-api-v2",{"id":V,"metadata":{"source":"api","author_email":"secret"},"resources":{"bindings":[],"script":{"named_handlers":[{"name":"BlueWebGateway"}]}}},V)
        self.assertTrue(report["gateway_export"])
        self.assertNotIn("secret",json.dumps(report))
    def test_probe_never_reads_body(self):
        class Response:
            def __init__(self,code,loc=""): self.code=code;self.headers={"Location":loc}
            def close(self): pass
            def read(self): raise AssertionError("must not read")
        class Opener:
            def __init__(self,res): self.res=res
            def open(self,req,timeout):
                assert req.get_method()=="GET"
                assert req.get_header("Authorization") is None
                return self.res
        for code,loc,expect in [(302,"https://team.cloudflareaccess.com/cdn-cgi/access/login?token=secret","ACCESS_LOGIN_REDIRECT"),(401,"","UNAUTHENTICATED_DENIED"),(200,"","UNEXPECTED_UNAUTHENTICATED_SUCCESS")]:
            out=probe(Opener(Response(code,loc)),"https://example.com/api")
            self.assertEqual(out["access"],expect)
            self.assertNotIn("secret",json.dumps(out))
if __name__=="__main__": unittest.main()
