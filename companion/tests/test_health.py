import pytest
from fastapi.testclient import TestClient
from companion.app import create_app


def reading(**changes):
    return dict(mission_day=1, observed_at='2025-01-01T12:00:00Z', source='instrument', device_id='PPG-01', protocol='resting-v1', metrics={'heart_rate_bpm': 70}, quality=1, consent_to_store=True, **changes)


@pytest.fixture
def client(tmp_path):
    app = create_app(database=tmp_path / 'crew.sqlite3')
    with TestClient(app) as client:
        assert client.post('/api/companion/profiles', json={'astronaut_id': 'CREW-01', 'display_name': 'Test'}).status_code == 201
        yield client


def test_health_persists_and_cascades(client):
    url = '/api/companion/profiles/CREW-01'
    assert client.post(url + '/health', json=reading()).status_code == 201
    assert len(client.get(url).json()['health']) == 1
    assert client.delete(url).status_code == 200
    assert client.get(url).status_code == 404


@pytest.mark.parametrize('change', [
    {'consent_to_store': False}, {'source': 'synthetic'}, {'metrics': {'spo2_pct': 101}},
    {'source': 'camera_rppg', 'metrics': {'spo2_pct': 97}}, {'source': 'camera_rppg', 'quality': .3},
    {'observed_at': '2025-01-01T12:00:00'}, {'metrics': {'bone_risk': 20}},
])
def test_health_rejects_unsupported_claims(client, change):
    payload = reading(); payload.update(change)
    assert client.post('/api/companion/profiles/CREW-01/health', json=payload).status_code == 422


def test_dose_cannot_decrease(client):
    url = '/api/companion/profiles/CREW-01/health'
    payload = reading(); payload['metrics'] = {'cumulative_dose_msv': 4}
    assert client.post(url, json=payload).status_code == 201
    payload.update(observed_at='2025-01-02T12:00:00Z', metrics={'cumulative_dose_msv': 3})
    assert client.post(url, json=payload).status_code == 422


def test_demo_health_is_explicitly_synthetic(client):
    profile = client.post('/api/companion/demo', json={}).json()
    records = client.get('/api/companion/profiles/' + profile['astronaut_id']).json()['health']
    assert len(records) == 6
    assert all(r['source'] == 'synthetic' for r in records)
