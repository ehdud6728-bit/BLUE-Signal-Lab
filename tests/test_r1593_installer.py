"""R1.5.9.3 regression: apply only exact reviewed code, reject changed anchors and reruns."""
import ast
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('blue_r1593_install',ROOT/'scripts'/'blue_r1593_install.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

def string(node):
 if isinstance(node,ast.Constant):return node.value
 if isinstance(node,ast.BinOp) and isinstance(node.op,ast.Add):return string(node.left)+string(node.right)
 raise ValueError('Unexpected non-literal patch')

def fixtures():
 tree=ast.parse((ROOT/'scripts'/'blue_r1593_install.py').read_text())
 fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='install')
 path=None;groups={}
 for stmt in fn.body:
  if isinstance(stmt,ast.Assign) and len(stmt.targets)==1 and isinstance(stmt.targets[0],ast.Name) and stmt.targets[0].id=='p':
   path=string(stmt.value)
  if isinstance(stmt,ast.Expr) and isinstance(stmt.value,ast.Call) and isinstance(stmt.value.func,ast.Name) and stmt.value.func.id=='replace_once':
   step,old,new=[string(x) for x in stmt.value.args[1:4]]
   if not old:raise ValueError('Empty patch anchor '+step)
   groups.setdefault(path,[]).append(old)
 return {p:'\nR1593_TEST_ANCHOR_BOUNDARY\n'.join(chunks) for p,chunks in groups.items()}

class Installer(unittest.TestCase):
 def work(self,fn):
  old=Path.cwd()
  with tempfile.TemporaryDirectory() as d:
   try:
    os.chdir(d)
    for p,content in fixtures().items():
     dest=Path(p);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(content)
    fn()
   finally:os.chdir(old)
 def test_idempotent_install(self):
  def go():
   mod.install(False);mod.install(True);snapshot={p:Path(p).read_text() for p in fixtures()}
   mod.install(False);mod.install(True)
   self.assertEqual(snapshot,{p:Path(p).read_text() for p in fixtures()})
   self.assertIn('/api/prices/compare',Path('worker/src/index.ts').read_text())
   self.assertIn('PriceCompareMini',Path('web/src/main.tsx').read_text())
  self.work(go)
 def test_refuses_changed_anchor(self):
  def go():
   p=Path('web/src/main.tsx');p.write_text(p.read_text().replace('const searchVersion=useRef(0)','const searchVersion=useRef(88)'))
   with self.assertRaisesRegex(RuntimeError,'R1593_ANCHOR_MISMATCH'):mod.install(False)
  self.work(go)
 def test_exactly_three_existing_files(self):
  self.assertEqual(set(fixtures()),{'worker/src/index.ts','web/src/main.tsx','web/src/SmartBasket.tsx'})

if __name__=='__main__':unittest.main()
