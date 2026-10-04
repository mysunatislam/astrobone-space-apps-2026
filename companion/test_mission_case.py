import json
from pathlib import Path
from fastapi.testclient import TestClient
from .app import create_app
from .test_companion import OfflineModel, demo, review

def test_shared_demo_and_selected_day_do_not_leak_future_data(tmp_path):
    with TestClient(create_app(tmp_path/'crew.sqlite3', OfflineModel())) as client:
        identifier = demo(client)
        scenario = json.loads((Path(__file__).resolve().parents[1]/'src/demoMission.json').read_text())
        record = client.get('/api/companion/profiles/'+identifier).json()
        assert record['profile']['display_name'] == scenario['profile']['display_name']
        assert [r['metrics'] for r in record['history']] == [r['metrics'] for r in scenario['observations']]
        assert [r['metrics'] for r in record['health']] == [r['metrics'] for r in scenario['health']]
        current = review(client, identifier, use_llm=False, as_of_day=180)
        assert current['comparison']['current_day'] == 180
        assert current['environment']['radiation']['status'] == 'synthetic'
        assert current['environment']['radiation']['cumulative_personal_absorbed_dose_mgy'] == 27
        assert current['multisystem']['series'][0]['last']['value'] == 76
        assert len(current['multisystem']['series'][0]['points']) == 4
        poor = review(client, identifier, use_llm=False, as_of_day=182)
        assert poor['priority']['status'] == 'insufficient_evidence'
        assert poor['comparison']['changes'] == []
        assert poor['multisystem']['series'][0]['last'] is None
        assert poor['multisystem']['series'][0]['delta'] is None
        assert poor['multisystem']['series'][0]['withheld']
        followup = review(client, identifier, use_llm=False, as_of_day=194)
        assert followup['comparison']['changes'][0]['current'] is not None

def test_followup_requires_consent_identity_and_cascades(tmp_path):
    app = create_app(tmp_path/'crew.sqlite3', OfflineModel())
    with TestClient(app) as client:
        identifier = demo(client)
        path = '/api/companion/profiles/'+identifier
        record = client.get(path).json()['history'][3]
        value = {'assessment_id':record['id'],'mission_day':180,'kind':'repeat_requested','consent_to_store':True}
        for changes in [{'consent_to_store':False},{'assessment_id':'other-person'},{'mission_day':181},{'kind':'prescribe'}]:
            assert client.post(path+'/followups',json={**value,**changes}).status_code == 422
        assert client.post(path+'/followups',json=value).status_code == 201
        assert len(client.get(path).json()['followups']) == 1
        assert review(client,identifier,use_llm=False,as_of_day=90)['followups'] == []
        assert len(review(client,identifier,use_llm=False,as_of_day=180)['followups']) == 1
        client.delete(path)
        with app.state.store.connect() as db:
            assert db.execute('SELECT COUNT(*) FROM followups').fetchone()[0] == 0

def test_no_shared_metrics_withholds_not_no_change():
    from .analysis import compare
    base = {'id':'a','mission_day':1,'is_baseline':True,'protocol':'same','gravity':'earth','source':'video','pose_model':'same','calibrated_distance':False,'tracking_quality':.9,'sample_count':20,'metrics':{'knee_extension_deg':165}}
    result = compare([base,{**base,'id':'b','mission_day':2,'is_baseline':False,'metrics':{'hip_rom_left_deg':40}}])
    assert not result['comparable']
    assert 'No shared' in result['reasons'][0]

def test_lexical_retrieval_relevance_and_abstention(tmp_path):
    from .retrieval import KnowledgeLibrary
    library = KnowledgeLibrary(OfflineModel(),tmp_path)
    dose = library.search('radiation dosimetry personal',use_embeddings=False)
    assert dose['sources'][0]['id'] == 'nasa-individual-dosimetry'
    assert library.search('quuxxyz zzzunknown',use_embeddings=False)['sources'] == []
    for chunk in library.chunks:
        assert chunk['url'].startswith('https://www.nasa.gov/')
        assert chunk['section'] and chunk['population']
