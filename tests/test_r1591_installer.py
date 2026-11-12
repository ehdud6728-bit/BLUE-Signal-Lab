"""Self-contained offline regression for installer idempotence and changed-file scope."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

HERE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('blue_r1591_apply', HERE/'scripts'/'blue_r1591_apply.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class R1591InstallerTests(unittest.TestCase):
 def anchors(self, func):
  found=[]
  fn=mod.patch_unique
  try:
   def capture(src,old,new,file,desc):
    found.append((old,new,file,desc))
    return src
   mod.patch_unique=capture
   func('')
  finally:mod.patch_unique=fn
  self.assertGreaterEqual(len(found),4)
  return found
 def test_main_additions_are_idempotent(self):
  anchors=self.anchors(mod.change_main)
  self.assertEqual(len({x[3] for x in anchors}),len(anchors))
  s='\n'.join(a for a,_,_,_ in anchors)
  got=mod.change_main(s)
  self.assertIn('techBadges(r)',got)
  self.assertIn('112선 돌파',got)
  self.assertEqual(got,mod.change_main(got))
 def test_basket_keeps_quota_and_protection(self):
  anchors=self.anchors(mod.change_basket)
  s='\n'.join(a for a,_,_,_ in anchors)
  got=mod.change_basket(s)
  self.assertIn('r1591-basket-tomato',got)
  self.assertIn('patternEvidence(data)',got)
  self.assertIn("perfId(x)===key",got)
  self.assertEqual(got,mod.change_basket(got))
 def test_refuses_modified_anchor(self):
  anchors=self.anchors(mod.change_main)
  src='\n'.join(a for a,_,_,_ in anchors)
  src=src.replace('const techFlag=', 'const techChanged=',1)
  with self.assertRaisesRegex(RuntimeError,'R1591_ANCHOR_MISMATCH'):
   mod.change_main(src)

if __name__=='__main__': unittest.main()
