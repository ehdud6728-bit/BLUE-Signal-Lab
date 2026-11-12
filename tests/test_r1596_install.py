import ast,sys,unittest,importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts'/'blue_r1596_install.py'
if not SCRIPT.is_file():SCRIPT=Path(__file__).with_name('install_r1596.py')
spec=importlib.util.spec_from_file_location('blue_r1596_install',SCRIPT)
installer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

class InstallerTest(unittest.TestCase):
 def test_anchors_are_unique_and_idempotent(self):
  tree=ast.parse(SCRIPT.read_text())
  fn={n.name:n for n in tree.body if isinstance(n,ast.FunctionDef)}
  fmap={'web/src/search-priority.ts':'patch_client','worker/src/search-quote-priority.ts':'patch_worker_queue',
  'collector/src/search-quote-priority.mjs':'patch_collector','worker/src/price-compare.ts':'patch_compare',
  'web/src/price-compare.ts':'patch_web_compare_type','web/src/PriceCompareMini.tsx':'patch_mini',
  'web/src/main.tsx':'patch_main','web/src/r1595-group-price.css':'patch_css'}
  # Regression for the 2026-11-12 GitHub failure: the source still says
  # literal "최근 확인가", never oldQuote before the patch.  The earlier test
  # used synthetic anchors only, so the incorrect anchor passed locally.
  mini=fn['patch_mini']
  substitutions=[(ast.literal_eval(n.args[1]),ast.literal_eval(n.args[2]),ast.literal_eval(n.args[3]))
    for n in ast.walk(mini) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='change']
  old=next(x[0] for x in substitutions if x[2]=='mini-price-action-stale-label')
  self.assertIn('<span>최근 확인가</span>',old)
  self.assertNotIn('{oldQuote?',old)
  self.assertIn("{received(data!.latest_at)}{difference(data!.latest_price,baseline)}",old)
  for p,f in fmap.items():
   with self.subTest(p=p):
    anchors=[]
    for n in ast.walk(fn[f]):
     if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='change':
      anchors.append((ast.literal_eval(n.args[1]),ast.literal_eval(n.args[2]),ast.literal_eval(n.args[3])))
    assert anchors
    originals=[x[0] for x in anchors]
    mock='\n'.join(originals)
    out=installer.patch_file(p,mock)
    self.assertNotEqual(mock,out)
    self.assertEqual(out,installer.patch_file(p,out))
    self.assertEqual(len(anchors),len(set(x[2] for x in anchors)))

 def test_exact_github_source_snapshots(self):
  # The 7 fixtures are byte-exact GitHub blobs at approved R1.5.9.5 main.
  # SHA1 is computed as a Git blob hash, not a raw file checksum.
  from hashlib import sha1
  sources={'web/src/search-priority.ts': ('web_search_priority.txt', '3cd1f1928acff37c4477750eff53eeb5f55122df'), 'web/src/PriceCompareMini.tsx': ('web_price_mini.txt', '3e0165e3d103122dc41aef26fc44dff6b8503552'), 'web/src/r1595-group-price.css': ('web_group_css.txt', 'aa993e743a36bd09bf8bffc65db4bbf4d41d30e7'), 'worker/src/search-quote-priority.ts': ('worker_search_priority.txt', '8f18eccd158404d9e8980d29d24fceac11a099ec'), 'worker/src/price-compare.ts': ('worker_price_compare.txt', 'c223ac79dd6c27e362ceaf9582894d4bbfeacad8'), 'web/src/price-compare.ts': ('web_price_compare.txt', '0fd7f50bc5f79c7eb46a8b1ad93447bb66e0932b'), 'collector/src/search-quote-priority.mjs': ('collector_search_priority.txt', 'c1b4194d52155fae0ae7c366213124f8a9c4e1cf')}
  for path,(fixture,expected_sha) in sources.items():
   with self.subTest(path=path):
    data=(ROOT/'tests/fixtures/r1596_sources'/fixture).read_bytes()
    actual=sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    self.assertEqual(actual,expected_sha,'source-fixture-drift')
    original=data.decode('utf-8')
    updated=installer.patch_file(path,original)
    self.assertNotEqual(updated,original)
    self.assertEqual(installer.patch_file(path,updated),updated)

if __name__=='__main__':unittest.main(verbosity=2)
