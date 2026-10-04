"""Solve the published Physiome equations unchanged; export reference cycles only."""
import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from scipy.integrate import solve_ivp
from vendor.physiome import windkessel as model

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT/'scripts/vendor/physiome'
URL = 'https://models.physiomeproject.org/e/43/MainWindKessel.cellml'


def cycle(bpm):
    print(f'Solving reference preset {bpm} bpm...', flush=True)
    initial, constants = model.initConsts()
    constants[10] = period = 60/bpm
    times = np.linspace(10*period, 12*period, 481)

    def solve(tolerance):
        solution = solve_ivp(lambda t, y: model.computeRates(t, y, constants),
                             (0, 12*period), initial, method='LSODA', t_eval=times,
                             max_step=period/100, rtol=tolerance, atol=tolerance/10)
        if not solution.success or not np.isfinite(solution.y).all():
            raise ValueError('Reference solver failed')
        return solution.y

    states = solve(1e-6)
    refined = solve(1e-7)
    convergence = float(np.max(np.abs(states-refined)))
    mass = constants[18]*refined[0]+refined[1]+refined[2]
    conservation = float(np.max(np.abs(mass-(constants[18]*initial[0]+initial[1]+initial[2]))))
    periodic = float(np.max(np.abs(refined[:, :241]-refined[:, 240:])))
    if convergence > .05 or conservation > 1e-4 or periodic > .05:
        raise ValueError(f'Numerical verification failed: {convergence}, {conservation}, {periodic}')
    values = model.computeAlgebraic(constants, refined, times)
    if not np.isfinite(values).all() or np.min(values[[5, 11]]) < -1e-6:
        raise ValueError('Nonfinite result or reverse ideal-valve flow')
    # The source defines UnitP as 133 Pa, not exactly 1 mmHg.
    p = 133/133.322387415
    samples = [dict(t=round(float(t-times[240]), 6), arterialPressure=round(float(refined[0,i]*p), 5),
                    ventricularPressure=round(float(values[3,i]*p), 5), atrialPressure=round(float(values[9,i]*p), 5),
                    ventricularVolume=round(float(refined[1,i]), 5), aorticFlow=round(float(values[5,i]), 5),
                    mitralFlow=round(float(values[11,i]), 5), systemicFlow=round(float(values[12,i]), 5))
               for i,t in enumerate(times) if i >= 240]
    return dict(bpm=bpm, periodSeconds=period, samples=samples,
                verification=dict(maxRefinementDifference=convergence, conservedVolumeErrorMl=conservation,
                                  maxCycleDifference=periodic, passed=True),
                parameters=constants)


def main():
    ns = {'c': 'http://www.cellml.org/cellml/1.1#'}
    units = ET.parse(VENDOR/'Units.cellml').getroot()
    if units.find('c:units[@name="UnitP"]/c:unit', ns).attrib != {'multiplier': '133', 'units': 'pascal'}:
        raise ValueError('Unexpected source pressure units')
    result = dict(schema='astrobone-circulation-reference-v1',
                  title='Left-heart / Windkessel reference circulation', source=URL,
                  license='CC-BY-3.0', revision='a47dc58c5d9bfff363de6a4ab2528d4513640d76',
                  sourceSha256=hashlib.sha256((VENDOR/'windkessel.py').read_bytes()).hexdigest(),
                  units=dict(pressure='mmHg', volume='mL', flow='mL/s', time='s'),
                  method='Unmodified CellML-generated equations, integrated using SciPy LSODA for 12 cycles. Source parameters retained except cycle period. Final cycle exported. Source pressure (133 Pa) converted to mmHg (133.322387415 Pa).',
                  boundary='Generic lumped-parameter left atrium, left ventricle and systemic compliance/resistance model. No right-heart, pulmonary, coronary, radiation or microgravity model. Not calibrated to Elena, NASA cohorts or the atlas geometry. Numerical checks are not physiological or clinical validation.',
                  scenarios=[cycle(bpm) for bpm in [60, 75, 90]])
    (ROOT/'public/data/circulation-reference.json').write_text(json.dumps(result, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    print(json.dumps([dict(bpm=s['bpm'], verification=s['verification']) for s in result['scenarios']]))


if __name__ == '__main__':
    main()
