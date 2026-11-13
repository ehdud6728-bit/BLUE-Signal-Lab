import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('chunks', ROOT/'scripts/append_chart_sql_r10.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class ChunkedChartSqlTests(unittest.TestCase):
    def test_lossless_large_unicode_chart_stats(self):
        # Deliberately larger than the old combined 90KB guard, with SQL quotes
        # and Hangul to test splitting on Unicode boundaries.
        item={'code':'000020','day':'2026-11-13',
              'chart':{'bars':[{'t':'2026-11-13','o':5000,'c':5200,'v':123,
                                'name':"이름'o'"*4} for _ in range(500)]},
              'stats':{'setups':[{'label':"매물대 '강'",'horizons':{'10':{'n':5,'up_pct':80}},
                                   'cases':[{'reason':'상승'*12} for _ in range(650)]}]}}
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);source=root/'data.jsonl';sql=root/'import.sql'
            source.write_text(json.dumps(item,ensure_ascii=False)+'\n',encoding='utf-8')
            sql.write_text('-- zero\n',encoding='utf-8')
            self.assertEqual(mod.append(source,sql,'blue_market_20261113'),1)
            stmts=[x+';' for x in sql.read_text(encoding='utf-8').split(';') if x.strip()]
            self.assertTrue(all(len(s.encode('utf-8'))<=mod.MAX_STATEMENT_BYTES for s in stmts if s.strip()!=';'))
            db=sqlite3.connect(':memory:');db.executescript(sql.read_text(encoding='utf-8'))
            chart,stats=db.execute('SELECT chart_json,stats_json FROM chart_snapshots').fetchone()
            self.assertEqual(json.loads(chart),item['chart'])
            self.assertEqual(json.loads(stats),item['stats'])
            self.assertTrue(len(chart.encode('utf-8'))+len(stats.encode('utf-8'))>90000)
    def test_idempotent_reimport_same_date(self):
        item={'code':'123456','day':'2026-11-12','chart':{'bars':[{'t':'2026-11-12','c':1}]},'stats':{'setups':[]}}
        with tempfile.TemporaryDirectory() as d:
            d=Path(d);inp=d/'a.jsonl';sql=d/'a.sql'
            inp.write_text(json.dumps(item)+'\n');sql.write_text('')
            mod.append(inp,sql,'r1')
            db=sqlite3.connect(':memory:');db.executescript(sql.read_text())
            db.executescript(sql.read_text())
            self.assertEqual(db.execute('SELECT COUNT(*) FROM chart_snapshots').fetchone()[0],1)
            self.assertEqual(json.loads(db.execute('SELECT stats_json FROM chart_snapshots').fetchone()[0]),item['stats'])
    def test_duplicate_fails_before_append(self):
        item={'code':'123456','day':'2026-11-12','chart':{},'stats':{}}
        with tempfile.TemporaryDirectory() as d:
            d=Path(d);inp=d/'a.jsonl';sql=d/'a.sql'
            inp.write_text((json.dumps(item)+'\n')*2);sql.write_text('original')
            with self.assertRaisesRegex(ValueError,'duplicate'):
                mod.append(inp,sql,'r1')
            self.assertEqual(sql.read_text(),'original')

if __name__=='__main__':unittest.main()
