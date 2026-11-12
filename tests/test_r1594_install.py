import importlib.util
import ast
from pathlib import Path
import tempfile
import unittest

file=Path(__file__).resolve().parents[1]/'scripts'/'blue_r1594_install.py'
spec=importlib.util.spec_from_file_location('r1594_install',file)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class R1594Installer(unittest.TestCase):
 def test_allowed_scope(self):
  self.assertEqual(set(m.ACTIONS),{
   'web/src/main.tsx','web/src/SmartBasket.tsx','web/src/LiveMarket.tsx','web/src/price-compare.ts',
   'worker/src/index.ts','worker/src/price-compare.ts','collector/src/index.mjs'})
 def test_replacement_fail_closed(self):
  with self.assertRaises(m.PatchError):m.change('no marker','abc','xyz','test')
  with self.assertRaises(m.PatchError):m.change('abcabc','abc','xyz','test')
 def test_idempotence(self):
  self.assertEqual(m.change('abc','abc','xyz','test'),'xyz')
  self.assertEqual(m.change('xyz','abc','xyz','test'),'xyz')
 def test_full_patch_can_be_checked_and_applied_twice(self):
  # Recreate all anchored source regions rather than testing change() in isolation.
  # This catches literal replacements that differ after a first pass.
  tree=ast.parse(file.read_text(encoding='utf-8'))
  by_function={}
  for fn in tree.body:
   if not isinstance(fn,ast.FunctionDef) or not fn.name.startswith('patch_'):continue
   old=[]
   for call in ast.walk(fn):
    if isinstance(call,ast.Call) and isinstance(call.func,ast.Name) and call.func.id=='change':
     old.append(ast.literal_eval(call.args[1]))
   if fn.name=='patch_main':
    old.append("setR1593Busy(true);setR1593Error('');setR1593Prices({});")
   by_function[fn.name]='\n__ANCHOR_SEPARATOR__\n'.join(old)
  expected={
   'web/src/main.tsx':'patch_main','web/src/SmartBasket.tsx':'patch_basket',
   'web/src/LiveMarket.tsx':'patch_tracking','web/src/price-compare.ts':'patch_priceclient',
   'worker/src/index.ts':'patch_index','worker/src/price-compare.ts':'patch_compare',
   'collector/src/index.mjs':'patch_collector',
  }
  with tempfile.TemporaryDirectory() as td:
   root=Path(td)
   for path,fn in expected.items():
    dest=root/path;dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(by_function[fn],encoding='utf-8')
   m.install(root,'check')
   m.install(root,'apply')
   first={name:(root/name).read_bytes() for name in expected}
   self.assertNotIn('setR1593Prices({})',first['web/src/main.tsx'].decode())
   self.assertIn('KIS 서버 우선 수집 대기 ${n}종목',first['web/src/main.tsx'].decode())
   m.install(root,'check')
   m.install(root,'apply')
   self.assertEqual(first,{name:(root/name).read_bytes() for name in expected})

 def test_check_does_not_modify(self):
  with tempfile.TemporaryDirectory() as td:
   base=Path(td)
   for file in m.ACTIONS:
    p=base/file;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('DO_NOT_CHANGE')
   with self.assertRaises(m.PatchError):m.install(base,'check')
   self.assertEqual((base/'web/src/main.tsx').read_text(),'DO_NOT_CHANGE')

if __name__=='__main__':unittest.main()
