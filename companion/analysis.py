from __future__ import annotations


UNAVAILABLE = {
    'bone_loading_risk': 'Not estimated: no measured forces or subject-specific bone capacity.',
    'muscle_deterioration_risk': 'Not estimated: movement change is not a measure of muscle mass or strength.',
    'balance_impairment_risk': 'Not estimated: no validated balance assessment model.',
    'injury_probability': 'Not estimated: no externally validated astronaut outcome model.',
}


def environment_context(history, radiation):
    current = history[-1] if history else None
    day = current['mission_day'] if current else (radiation[-1]['mission_day'] if radiation else None)
    eligible = [row for row in radiation if day is None or row['mission_day'] <= day]
    reading = eligible[-1] if eligible else None
    return {
        'mission_day':day,
        'observation_gravity':current['gravity'] if current else None,
        'radiation':{
            'status':('synthetic' if reading.get('source') == 'synthetic' else 'instrument_recorded') if reading else 'not_provided',
            'cumulative_personal_absorbed_dose_mgy':reading['cumulative_personal_absorbed_dose_mgy'] if reading else None,
            'reading_day':reading['mission_day'] if reading else None,
            'instrument_id':reading['instrument_id'] if reading else None,
            'interpretation':'Operator-entered instrument context; device provenance is not authenticated. No organ or bone dose, causal attribution, or radiation-musculoskeletal risk score is inferred.',
            'source_url':'https://www.nasa.gov/reference/6-0-natural-and-induced-environments-vol-2/',
        },
        'fusion_status':'not_validated',
    }


def compare(history):
    baseline = next((row for row in history if row['is_baseline']), None)
    current = history[-1] if history else None
    reasons = []
    if not baseline:
        reasons.append('A crew-approved personal baseline is missing.')
    if not current or current == baseline:
        reasons.append('A follow-up observation is required.')
    if baseline and current:
        for field in ('protocol', 'gravity', 'source', 'pose_model', 'calibrated_distance'):
            if baseline[field] != current[field]:
                reasons.append(f'Baseline and current {field} differ; numerical comparison withheld.')
        if baseline['mission_day'] > current['mission_day']:
            reasons.append('Baseline cannot occur after follow-up.')
        if min(baseline['tracking_quality'], current['tracking_quality']) < .7 or min(baseline['sample_count'], current['sample_count']) < 12:
            reasons.append('Capture quality does not pass the engineering comparison gate.')
    changes = []
    if not reasons:
        for key in sorted(set(baseline['metrics']) & set(current['metrics'])):
            old, new = baseline['metrics'][key], current['metrics'][key]
            delta = new - old
            percent = 100 * delta / abs(old) if abs(old) > 1e-8 else None
            changes.append({'id': 'change:' + key, 'metric': key, 'baseline': old, 'current': new,
                            'delta': round(delta, 3), 'percent_change': round(percent, 2) if percent is not None else None,
                            'unit': 'deg/s' if key.endswith('_deg_s') else 'deg' if key.endswith('_deg') else 'm/s' if key.endswith('_m_s') else 'm' if key.endswith('_m') else 'cycles/min' if key.endswith('_min') else 'normalized'})
        if not changes:
            reasons.append('No shared finite measurement is available.')
    return {'comparable': not reasons, 'reasons': reasons, 'baseline_id': baseline['id'] if baseline else None,
            'current_id': current['id'] if current else None,
            'baseline_day': baseline['mission_day'] if baseline else None,
            'current_day': current['mission_day'] if current else None, 'changes': changes}


def review_priority(comparison, red_flags):
    if red_flags:
        return {'status': 'human_review_now', 'reason': 'Crew-reported warning signs: use the approved onboard escalation protocol; do not wait for AI analysis.', 'clinical_predictions': UNAVAILABLE}
    if not comparison['comparable']:
        return {'status': 'insufficient_evidence', 'reason': 'Comparison withheld: ' + ' '.join(comparison['reasons']), 'clinical_predictions': UNAVAILABLE}
    # A visible change is descriptive. No arbitrary percentage becomes a clinical risk cutoff.
    changed = any(abs(row['delta']) >= .1 for row in comparison['changes'])
    return {'status': 'change_observed' if changed else 'no_resolved_change',
            'reason': 'Observed differences require repeatable measurement and qualified interpretation; cause and clinical significance are undetermined.',
            'clinical_predictions': UNAVAILABLE}


def actions_for(profile, comparison, red_flags):
    if red_flags:
        return [{'id': 'escalate', 'text': 'Use the approved onboard medical escalation protocol and contact the designated medical officer.', 'approval': 'human-led', 'equipment': None}]
    actions = [{'id': 'review_capture', 'text': 'Review capture framing, visibility, protocol, and gravity context before interpreting the comparison.', 'approval': 'crew review', 'equipment': 'camera'},
               {'id': 'handoff', 'text': 'Export the observations, limitations, and cited evidence for flight-surgeon review.', 'approval': 'crew approval before transmission', 'equipment': None}]
    if 'camera' in profile['equipment']:
        actions.insert(1, {'id': 'repeat_observation', 'text': 'Consider a repeat observation under the same approved assessment protocol, only when appropriate for the crew member.', 'approval': 'approved protocol and human review required', 'equipment': 'camera'})
    return [a for a in actions if a['equipment'] is None or a['equipment'] in profile['equipment']]


def finding_text(change, comparison):
    label = change['metric'].replace('_', ' ').removesuffix(' deg')
    percent = '' if change['percent_change'] is None else f" ({change['percent_change']:+.1f}% relative to baseline)"
    return f"{label}: {change['baseline']:g} to {change['current']:g} {change['unit']}, Day {comparison['baseline_day']} to Day {comparison['current_day']}{percent}. This is an observed change, not a diagnosis."
