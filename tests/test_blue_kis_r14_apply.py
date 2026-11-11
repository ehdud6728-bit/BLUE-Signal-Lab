import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS=Path(__file__).resolve().parents[1]/'scripts'
sys.path.insert(0,str(SCRIPTS))
from blue_kis_r14_apply import change_web,change_worker,apply

class InstallerTests(unittest.TestCase):
    def test_web_idempotence(self):
        src="import StockChart from './StockChart';\nconst X = <section className=\"content\">foo</section>;"
        changed=change_web(src)
        self.assertIn('<LiveMarket />',changed)
        self.assertEqual(changed,change_web(changed))
        self.assertIn("import LiveMarket from './LiveMarket';",changed)
    def test_worker_idempotence_and_access(self):
        src="import { handleAi, getCachedAi } from './ai';\nconst p='';\n      if (p === '/api/health' && request.method === 'GET') {"
        changed=change_worker(src)
        self.assertEqual(changed,change_worker(changed))
        self.assertIn('if (!access)',changed)
        self.assertIn('await liveQuotes(env.DB)',changed)
        self.assertEqual(changed.count("p === '/api/live/quotes'"),1)
    def test_fails_closed_on_unknown_layout(self):
        with self.assertRaises(ValueError):change_web('wrong-layout')
        with self.assertRaises(ValueError):change_worker('wrong-layout')
    def test_dry_run_never_mutates_existing(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            for p in ['web/src','worker/src','scripts']:(root/p).mkdir(parents=True,exist_ok=True)
            files=['web/src/LiveMarket.tsx','web/src/live-market.css','worker/src/live.ts','scripts/blue_kis_web_live_r14.py']
            for p in files:(root/p).write_text('new',encoding='utf-8')
            w=root/'web/src/main.tsx';api=root/'worker/src/index.ts'
            w.write_text("import StockChart from './StockChart';\n<section className=\"content\">",encoding='utf-8')
            api.write_text("import { handleAi, getCachedAi } from './ai';\n      if (p === '/api/health' && request.method === 'GET') {",encoding='utf-8')
            before=[w.read_text(),api.read_text()]
            a=apply(root,False)
            self.assertEqual([w.read_text(),api.read_text()],before)
            self.assertEqual(set(a.values()),{'modified'})
            apply(root,True);self.assertIn('<LiveMarket />',w.read_text())
            b=apply(root,False);self.assertEqual(set(b.values()),{'unchanged'})

if __name__=='__main__':unittest.main()
