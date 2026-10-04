"""Small scientific transformation tests, independent of network services."""
import io
import unittest
from zipfile import ZipFile
from build_mission_research import cardiovascular, radiation


def metadata(dose='0.1', unit='gray'):
    buffer = io.BytesIO()
    with ZipFile(buffer, 'w') as archive:
        archive.writestr('s_OSD-435.txt', '\t'.join(['Sample Name', 'Source Name', 'Characteristics[Organism]',
            'Factor Value[Absorbed Radiation Dose]', 'Unit', 'Factor Value[Time Post-Irradiation]', 'Unit', 'Factor Value[Ionizing Radiation]']) + '\n'
            + '\t'.join(['a', 'mouse1', 'Mus musculus', dose, unit, '3', 'month', 'O-16 ion radiation']) + '\n')
    return buffer.getvalue()


class ResearchTests(unittest.TestCase):
    def test_crp_units_median_and_population(self):
        data = b'Sample Name,crp_concentration_picogram_per_milliliter\nC1_serum_R+1,1000000\nC2_serum_R+1,3000000\n'
        result = cardiovascular(data)
        self.assertEqual(result['points'], [{'visit': 'R+1', 'n': 2, 'median': 2.0}])
        self.assertEqual(result['participants'], 2)

    def test_join_units_and_exclusions(self):
        data = b'sample_name,ejection_fraction_percent\na,62.4\n'
        result = radiation(data, metadata())
        self.assertEqual(result['groups'][0]['median'], 62.4)
        self.assertEqual(result['groups'][0]['doseGy'], .1)
        self.assertEqual(result['groups'][0]['month'], 3)
        mixed = radiation(data, metadata(dose='0.5, 1'))
        self.assertEqual(mixed['exclusions']['nonScalarDose'], 1)
        self.assertEqual(mixed['groups'], [])
        with self.assertRaises(ValueError):
            radiation(data, metadata(unit='milligray'))
        with self.assertRaises(ValueError):
            radiation(b'sample_name,ejection_fraction_percent\nother,62.4\n', metadata())


if __name__ == '__main__':
    unittest.main()
