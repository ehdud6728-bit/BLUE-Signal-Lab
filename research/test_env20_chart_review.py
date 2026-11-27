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
    def test_dates_ohlc_and_divergent_exact_path_rejected(self):
        from copy import deepcopy
        for mode in ('same_day','duplicate','ohlc','diverge','hash'):
            c,o=self.fixture();a=o[0];b=a['post_bars'][0]
            if mode=='same_day':b['day']=c[0]['day']
            elif mode=='duplicate':a['post_bars'].append(deepcopy(b))
            elif mode=='ohlc':b['low']=200
            else:
                a.update(landmark_path_version=1,landmark_bars=[deepcopy(b)],landmark_source_hashes={b['day']:'a'*64})
                if mode=='diverge':a['landmark_bars'][0]['close']=102
                else:a['landmark_source_hashes']={}
            with self.subTest(mode=mode),self.assertRaises(ValueError):verify(c,o)
    def test_exact_prefix_links_and_legacy_status(self):
        from copy import deepcopy
        c,o=self.fixture();a=o[0];b=a['post_bars'][0]
        a.update(landmark_path_version=1,landmark_bars=[deepcopy(b)],landmark_source_hashes={b['day']:'a'*64})
        self.assertEqual(verify(c,o)['exact_paths_checked'],1)
        a['source_hashes']={b['day']:'b'*64}
        with self.assertRaisesRegex(ValueError,'CHART_OUTCOME_HASH_MISMATCH'):verify(c,o)
if __name__=='__main__':unittest.main()
