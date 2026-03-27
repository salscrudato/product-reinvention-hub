from components.servicenow_extended_tools import (
    fetch_incident_counts_by_priority, fetch_trending_incidents,
    fetch_mean_time_to_resolution_stats, fetch_open_vs_closed_counts,
    fetch_unassigned_incidents, fetch_top_assignment_groups,
    fetch_incident_state_timeline, fetch_incident_work_notes_summary,
    fetch_incident_attachment_list, fetch_incident_assignment_history,
    fetch_ci_incident_density, fetch_recent_failed_changes,
    fetch_related_commits_stub, create_draft_problem_record
)

# These tests operate implicitly in stub mode if SERVICENOW_INSTANCE is not configured.


def test_priority_counts_stub():
    res = fetch_incident_counts_by_priority(days=3)
    assert 'by_priority' in res


def test_trending_incidents_stub():
    res = fetch_trending_incidents(days=3)
    assert 'top_terms' in res


def test_mttr_stub():
    res = fetch_mean_time_to_resolution_stats(days=5)
    assert 'mttr_hours' in res


def test_open_vs_closed_stub():
    res = fetch_open_vs_closed_counts(days=7)
    assert 'open' in res and 'closed' in res


def test_unassigned_stub():
    res = fetch_unassigned_incidents(limit=5)
    assert 'unassigned_sample' in res


def test_top_assignment_groups_stub():
    res = fetch_top_assignment_groups(days=5)
    assert 'groups' in res


def test_state_timeline_stub():
    res = fetch_incident_state_timeline('INC123')
    assert 'incident' in res


def test_work_notes_summary_stub():
    res = fetch_incident_work_notes_summary('INC123')
    assert 'work_notes_excerpt' in res or 'error' in res


def test_attachment_list_stub():
    res = fetch_incident_attachment_list('INC123')
    assert 'incident' in res


def test_assignment_history_stub():
    res = fetch_incident_assignment_history('INC123')
    assert 'assignments' in res


def test_ci_incident_density_stub():
    res = fetch_ci_incident_density(days=10)
    assert 'top_ci' in res


def test_recent_failed_changes_stub():
    res = fetch_recent_failed_changes(days=10)
    assert 'failed_changes' in res


def test_related_commits_stub():
    res = fetch_related_commits_stub('INC777')
    assert 'commits' in res


def test_create_draft_problem_record_stub():
    res = create_draft_problem_record('INC777')
    assert 'problem_number' in res or 'result' in res or 'error' in res
