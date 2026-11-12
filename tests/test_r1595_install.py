import ast,importlib.util,tempfile,unittest
from pathlib import Path
file=Path(__file__).resolve().parents[1]/'scripts'/'blue_r1595_install.py'
spec=importlib.util.spec_from_file_location('r1595_install',file)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class R1595Installer(unittest.TestCase):
 def test_scope_exact(self):
  self.assertEqual(set(m.ACTIONS),{
   'web/src/SmartBasket.tsx','web/src/main.tsx','web/src/price-compare.ts',
   'collector/src/search-quote-priority.mjs'})
 def test_replacements_fail_closed(self):
  with self.assertRaises(m.PatchError):m.change('abc','absent','replacement','test')
  with self.assertRaises(m.PatchError):m.change('abcabc','abc','replacement','test')
 def test_double_application_replay_safe(self):
  tree=ast.parse(file.read_text(encoding='utf-8'))
  function_to_old={}
  for node in tree.body:
   if not isinstance(node,ast.FunctionDef) or not node.name.startswith('patch_'):continue
   strings=[]
   for c in ast.walk(node):
    if isinstance(c,ast.Call) and isinstance(c.func,ast.Name) and c.func.id=='change':
     if isinstance(c.args[1],ast.Constant):strings.append(ast.literal_eval(c.args[1]))
   if node.name=='patch_client':
    for v in node.body:
     if isinstance(v,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='old' for t in v.targets):
      strings.append(ast.literal_eval(v.value))
   function_to_old[node.name]='\n__R1595_SEPARATOR__\n'.join(strings)
  paths={'web/src/SmartBasket.tsx':'patch_basket','web/src/main.tsx':'patch_main',
         'web/src/price-compare.ts':'patch_client','collector/src/search-quote-priority.mjs':'patch_collector'}
  with tempfile.TemporaryDirectory() as td:
   root=Path(td)
   for p,f in paths.items():
    path=root/p;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(function_to_old[f],encoding='utf-8')
   m.install(root,'check');m.install(root,'apply')
   after={p:(root/p).read_bytes() for p in paths}
   self.assertIn(b'r1595-group-header',after['web/src/SmartBasket.tsx'])
   self.assertIn(b'signal?:AbortSignal,',after['web/src/price-compare.ts'])
   m.install(root,'check');m.install(root,'apply')
   self.assertEqual(after,{p:(root/p).read_bytes() for p in paths})
 def test_drift_blocks_all_writes(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td)
   for p in m.ACTIONS:
    dest=root/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text('DRIFT',encoding='utf-8')
   with self.assertRaises(m.PatchError):m.install(root,'apply')
   self.assertEqual((root/'web/src/main.tsx').read_text(),'DRIFT')

if __name__=='__main__':unittest.main()
