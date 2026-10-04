import unittest
from build_extended_nasa_research import summarize

SPEC = dict(tissue='whole-blood', metrics=[('value_percent', 'Test', '%')])


class AssayTests(unittest.TestCase):
    def test_medians_missing_and_visit_order(self):
        data = b'Sample Name,value_percent\nC001_whole-blood_R+1_cbc,0\nC001_whole-blood_L-3_cbc,4\nC002_whole-blood_L-3_cbc,6\nC003_whole-blood_L-3_cbc,nan\n'
        result = summarize(data, SPEC)
        points = result['metrics'][0]['points']
        self.assertEqual(result['participants'], 3)
        self.assertEqual([p['visit'] for p in points], ['L-3', 'R+1'])
        self.assertEqual(points[0]['median'], 5)
        self.assertEqual(points[0]['missing'], 1)
        self.assertEqual(points[1]['reportedZeros'], 1)

    def test_reject_duplicate_sample(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            summarize(b'Sample Name,value_percent\nC001_whole-blood_L-3,1\nC001_whole-blood_L-3,2\n', SPEC)

    def test_reject_ambiguous_units_and_unknown_visits(self):
        for data in [b'Sample Name,value_percent,value_percent\n',
                     b'Sample Name,value_mg\n', b'Sample Name,value_percent\nC001_whole-blood_Day180,2\n']:
            with self.assertRaises(ValueError):
                summarize(data, SPEC)

    def test_all_missing_is_not_zero(self):
        result = summarize(b'Sample Name,value_percent,,\nC001_whole-blood_L-3,inf,x,y\n', SPEC)
        self.assertIsNone(result['metrics'][0]['points'][0]['median'])
        self.assertEqual(result['blankColumnsIgnored'], 2)


if __name__ == '__main__':
    unittest.main()
