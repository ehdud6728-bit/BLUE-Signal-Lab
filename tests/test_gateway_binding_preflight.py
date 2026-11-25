import unittest
from tools.gateway_binding_preflight import frontend_state,routine_decision
good={"type":"service","name":"BLUE_API","service":"blue-signal-lab-api-v2","entrypoint":"BlueWebGateway"}
asset={"type":"assets","name":"ASSETS"}
partial={k:v for k,v in good.items() if k!="entrypoint"}
class BindingTests(unittest.TestCase):
    def test_settings_exact(self):
        self.assertEqual(routine_decision([asset,good],None,"deploy_web"),"VERIFIED_SETTINGS")
    def test_version_exact(self):
        for settings in ([asset],[asset,partial]):
            self.assertEqual(routine_decision(settings,[good],"deploy_web"),"VERIFIED_ACTIVE_VERSION")
    def test_full_deploy_repairs_unreported_or_absent_binding(self):
        for settings,version in [([asset],[asset]),([partial],[partial])]:
            self.assertEqual(routine_decision(settings,version,"deploy_api_and_web"),"REBUILD_FULL_DEPLOY")
            for mode in ("deploy_web","deploy_api"):
                with self.assertRaises(ValueError): routine_decision(settings,version,mode)
    def test_wrong_targets_and_unknown_bindings_block_even_full_repair(self):
        for bad in [dict(good,service="wrong"),dict(good,entrypoint="wrong"),{"type":"kv_namespace","name":"KV"}]:
            for settings,version in [([bad],[good]),([asset],[bad])]:
                with self.assertRaises(ValueError): routine_decision(settings,version,"deploy_api_and_web")
    def test_missing_metadata_and_duplicates_block(self):
        for bad in (None,{},[good,good]):
            with self.assertRaises(ValueError): routine_decision([asset],bad,"deploy_api_and_web")
if __name__=="__main__": unittest.main()
