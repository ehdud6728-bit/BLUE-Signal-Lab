import unittest,sys,tempfile,sqlite3,csv
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from csv_to_d1 import export
ROOT=Path(__file__).parents[1]
class ImportTests(unittest.TestCase):
 def test_import_and_empty_days(self):
  with tempfile.TemporaryDirectory() as t:
   src=Path(t)
   (src/'signals.csv').write_text('code,date,signals,close,distance_to_nearest_supply_pct\n005930,2026-11-09,"BB20,ENV20",1000,5.3\n',encoding='utf-8')
   (src/'daily_counts.csv').write_text('date,observed_stocks,signal_events,matched_stocks\n2026-11-07,1,0,0\n2026-11-09,1,2,1\n',encoding='utf-8')
   out=src/'import.sql';r=export(src,out,'test-1','SYNTHETIC',True)
   db=sqlite3.connect(':memory:');db.executescript((ROOT/'worker/schema.sql').read_text());db.executescript(out.read_text())
   self.assertEqual(db.execute('select count(*) from signals').fetchone()[0],1)
   self.assertEqual(db.execute('select count(*) from daily_counts').fetchone()[0],2)
   self.assertEqual(db.execute('select signal_names from signals').fetchone()[0],'BB20,ENV20')
   self.assertEqual(db.execute('select count(*) from signals where run_id=? and day between ? and ? and (\',\'||signal_names||\',\') LIKE ?',('test-1','2026-11-09','2026-11-09','%,BB20,%')).fetchone()[0],1)
   self.assertEqual(r['latest_date'],'2026-11-09')
 def test_reject_duplicates(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);(p/'signals.csv').write_text('code,date,signals,close,distance_to_nearest_supply_pct\nTEST,2026-11-09,BB20,10,1\nTEST,2026-11-09,BB40,11,1\n');(p/'daily_counts.csv').write_text('date,observed_stocks,signal_events,matched_stocks\n')
   with self.assertRaises(ValueError):export(p,p/'out.sql','test2','TEST')
 def test_sql_escape(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);(p/'signals.csv').write_text('code,date,signals,close,distance_to_nearest_supply_pct\n');(p/'daily_counts.csv').write_text('date,observed_stocks,signal_events,matched_stocks\n')
   export(p,p/'out.sql','test3',"O'Hara")
   db=sqlite3.connect(':memory:');db.executescript((ROOT/'worker/schema.sql').read_text());db.executescript((p/'out.sql').read_text());self.assertEqual(db.execute('select source from runs').fetchone()[0],"O'Hara")
if __name__=='__main__': unittest.main()
