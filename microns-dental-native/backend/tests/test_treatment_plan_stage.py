from app.models.treatment_plan import TreatmentPlanStage


def test_stage_progression():
    assert TreatmentPlanStage.next_stage(TreatmentPlanStage.PRESENTED) == TreatmentPlanStage.DAY1_SENT
    assert TreatmentPlanStage.next_stage(TreatmentPlanStage.DAY1_SENT) == TreatmentPlanStage.DAY3_SENT
    assert TreatmentPlanStage.next_stage(TreatmentPlanStage.DAY3_SENT) == TreatmentPlanStage.DAY7_SENT
    assert TreatmentPlanStage.next_stage(TreatmentPlanStage.DAY7_SENT) == TreatmentPlanStage.DAY14_SENT


def test_final_stage_has_no_next_stage():
    """DAY14_SENT is terminal: approving its (Day-30) message ends the drip."""
    assert TreatmentPlanStage.next_stage(TreatmentPlanStage.DAY14_SENT) is None


def test_unknown_stage_returns_none():
    assert TreatmentPlanStage.next_stage("not_a_real_stage") is None


def test_offset_days_cover_every_non_terminal_stage():
    for stage in TreatmentPlanStage.ORDER:
        assert stage in TreatmentPlanStage.OFFSET_DAYS
