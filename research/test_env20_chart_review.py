import unittest
from env20_chart_review import render,verify
class Charts(unittest.TestCase):
    def fixture(self):
        b=dict(day='2026-10-02',open=100,high=106,low=98,close=101)
        return [dict(id='x',code='000001',day='2026-10-01',pre_bars=[dict(b,day='2026-10-01')],name='<script>')],[dict(id='x',post_bars=[b],horizons={'1':dict(status='OBSERVED',peak_pct=6,trough_pct=-2,hit5=True)})]
    def test_exact_prices_hidden_future_and_escaped_names(self):
        c,o=self.fixture();page,a=render(c,o)
        self.assertEqual(a['observed_horizons_checked'],1);self.assertIn('<details>',page);self.assertNotIn('<script>',page);self.assertIn('2026-10-02 O 100 H 106 L 98 C 101',page)
    def test_changed_price_or_missing_id_rejected(self):
        c,o=self.fixture();o[0]['horizons']['1']['peak_pct']=7
        with self.assertRaisesRegex(ValueError,'OUTCOME_PRICE_MISMATCH'):verify(c,o)
        with self.assertRaisesRegex(ValueError,'CASE_ID_MISMATCH'):verify(c,[])
if __name__=='__main__':unittest.main()
