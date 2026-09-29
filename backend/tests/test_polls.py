"""Unit and integration tests for the polls service and rules engine."""

from datetime import datetime, timezone
import pytest

from app.errors import (
    MemberGroupMismatchError,
    MemberInactiveError,
    OptionPollMismatchError,
    PollClosedError,
    PollValidationError,
)
from app.services.polls import (
    PollOptionInput,
    add_member,
    all_reached,
    cast_vote,
    close_poll,
    create_group,
    create_poll,
    get_member_history,
    get_poll_status,
    remove_vote,
)


def dt(hour: int, minute: int = 0) -> datetime:
    """Helper to generate timezone-aware UTC datetime on 2026-09-29."""
    return datetime(2026, 9, 29, hour, minute, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Test 1: Single-choice switching history
# ---------------------------------------------------------------------------
def test_1_single_choice_history_tracking(db_session):
    """
    Single-choice poll: member selects Yes at 2:00, switches to No at 2:30,
    back to Yes at 3:00, then to No and Yes again at 4:00 PM.
    History for Yes shows first = 2:00 and last = 4:00 with nothing in between stored;
    No keeps only its own first and last times.
    """
    group = create_group(db_session, "Team A")
    member = add_member(db_session, group.id, "Alice")
    poll = create_poll(
        db_session,
        group_id=group.id,
        name="Lunch Poll",
        allow_multiple=False,
        options=[
            PollOptionInput(label="Yes", role="target"),
            PollOptionInput(label="No", role="not_yet"),
        ],
    )
    opt_yes = [o for o in poll.options if o.label == "Yes"][0]
    opt_no = [o for o in poll.options if o.label == "No"][0]

    t_1400 = dt(14, 0)
    t_1430 = dt(14, 30)
    t_1500 = dt(15, 0)
    t_1600_a = dt(16, 0)
    t_1600_b = dt(16, 0)

    # 1. 2:00 PM - Selects Yes
    cast_vote(db_session, poll.id, member.id, opt_yes.id, now=t_1400)
    # 2. 2:30 PM - Switches to No
    cast_vote(db_session, poll.id, member.id, opt_no.id, now=t_1430)
    # 3. 3:00 PM - Back to Yes
    cast_vote(db_session, poll.id, member.id, opt_yes.id, now=t_1500)
    # 4. 4:00 PM - Switches to No
    cast_vote(db_session, poll.id, member.id, opt_no.id, now=t_1600_a)
    # 5. 4:00 PM - And Yes again
    cast_vote(db_session, poll.id, member.id, opt_yes.id, now=t_1600_b)

    history = get_member_history(db_session, poll.id, member.id)
    history_by_label = {h.option_label: h for h in history}

    assert "Yes" in history_by_label
    assert "No" in history_by_label
    assert len(history) == 2

    # Yes history: first=14:00, last=16:00, currently selected
    yes_hist = history_by_label["Yes"]
    assert yes_hist.first_selected_at == t_1400
    assert yes_hist.last_selected_at == t_1600_b
    assert yes_hist.is_selected is True

    # No history: first=14:30, last=16:00, not currently selected
    no_hist = history_by_label["No"]
    assert no_hist.first_selected_at == t_1430
    assert no_hist.last_selected_at == t_1600_a
    assert no_hist.is_selected is False


# ---------------------------------------------------------------------------
# Test 2: Re-selecting already selected option is a no-op
# ---------------------------------------------------------------------------
def test_2_reselecting_active_option_preserves_timestamps(db_session):
    """Re-selecting the already selected option does not change any timestamp (both single and multiple mode)."""
    group = create_group(db_session, "Team B")
    m1 = add_member(db_session, group.id, "Alice")
    m2 = add_member(db_session, group.id, "Bob")

    t1 = dt(10, 0)
    t2 = dt(11, 0)

    # Single mode
    poll_single = create_poll(
        db_session,
        group_id=group.id,
        name="Single Poll",
        allow_multiple=False,
        options=[
            PollOptionInput(label="Opt1", role="target"),
            PollOptionInput(label="Opt2", role="not_yet"),
        ],
    )
    opt1 = poll_single.options[0]
    cast_vote(db_session, poll_single.id, m1.id, opt1.id, now=t1)
    # Re-select same option at later time
    cast_vote(db_session, poll_single.id, m1.id, opt1.id, now=t2)

    hist_single = get_member_history(db_session, poll_single.id, m1.id)
    assert len(hist_single) == 1
    assert hist_single[0].first_selected_at == t1
    assert hist_single[0].last_selected_at == t1  # Timestamps NOT updated

    # Multiple mode
    poll_multi = create_poll(
        db_session,
        group_id=group.id,
        name="Multi Poll",
        allow_multiple=True,
        options=[
            PollOptionInput(label="OptA", role="target"),
            PollOptionInput(label="OptB", role="in_progress"),
        ],
    )
    optA = poll_multi.options[0]
    optB = poll_multi.options[1]
    cast_vote(db_session, poll_multi.id, m2.id, optA.id, now=t1)
    cast_vote(db_session, poll_multi.id, m2.id, optB.id, now=t1)

    # Re-select OptA at t2
    cast_vote(db_session, poll_multi.id, m2.id, optA.id, now=t2)

    hist_multi = {h.option_label: h for h in get_member_history(db_session, poll_multi.id, m2.id)}
    assert hist_multi["OptA"].first_selected_at == t1
    assert hist_multi["OptA"].last_selected_at == t1  # Preserved
    assert hist_multi["OptB"].first_selected_at == t1
    assert hist_multi["OptB"].last_selected_at == t1


# ---------------------------------------------------------------------------
# Test 3: Single mode replaces previous selection
# ---------------------------------------------------------------------------
def test_3_single_mode_replaces_selection(db_session):
    """Single mode: selecting a second option replaces the first (only one current selection)."""
    group = create_group(db_session, "Team C")
    member = add_member(db_session, group.id, "Alice")
    poll = create_poll(
        db_session,
        group_id=group.id,
        name="Choice Poll",
        allow_multiple=False,
        options=[
            PollOptionInput(label="Choice 1", role="target"),
            PollOptionInput(label="Choice 2", role="not_yet"),
        ],
    )
    opt1, opt2 = poll.options[0], poll.options[1]

    cast_vote(db_session, poll.id, member.id, opt1.id, now=dt(10, 0))
    status1 = get_poll_status(db_session, poll.id)
    assert len(status1.at_target) == 1
    assert status1.at_target[0].member.id == member.id

    # Switch to Choice 2
    cast_vote(db_session, poll.id, member.id, opt2.id, now=dt(11, 0))
    status2 = get_poll_status(db_session, poll.id)
    assert len(status2.at_target) == 0
    assert len(status2.behind_target) == 1
    assert status2.behind_target[0].id == member.id

    # Check history current selection flag
    hist = {h.option_label: h for h in get_member_history(db_session, poll.id, member.id)}
    assert hist["Choice 1"].is_selected is False
    assert hist["Choice 2"].is_selected is True


# ---------------------------------------------------------------------------
# Test 4: Multiple mode holds multiple and partial removals
# ---------------------------------------------------------------------------
def test_4_multiple_mode_operations(db_session):
    """Multiple mode: a member can hold two selections at once; removing one leaves the other; removing with no option clears both."""
    group = create_group(db_session, "Team D")
    member = add_member(db_session, group.id, "Alice")
    poll = create_poll(
        db_session,
        group_id=group.id,
        name="Multi Poll",
        allow_multiple=True,
        options=[
            PollOptionInput(label="Task 1", role="target"),
            PollOptionInput(label="Task 2", role="target"),
        ],
    )
    opt1, opt2 = poll.options[0], poll.options[1]

    # Select both
    cast_vote(db_session, poll.id, member.id, opt1.id, now=dt(10, 0))
    cast_vote(db_session, poll.id, member.id, opt2.id, now=dt(10, 30))

    hist = {h.option_label: h for h in get_member_history(db_session, poll.id, member.id)}
    assert hist["Task 1"].is_selected is True
    assert hist["Task 2"].is_selected is True

    # Remove only Task 1
    remove_vote(db_session, poll.id, member.id, option_id=opt1.id)
    hist_after_opt1 = {h.option_label: h for h in get_member_history(db_session, poll.id, member.id)}
    assert hist_after_opt1["Task 1"].is_selected is False
    assert hist_after_opt1["Task 2"].is_selected is True

    # Re-add Task 1 so both are selected
    cast_vote(db_session, poll.id, member.id, opt1.id, now=dt(11, 0))
    # Remove all selections
    remove_vote(db_session, poll.id, member.id, option_id=None)
    hist_cleared = {h.option_label: h for h in get_member_history(db_session, poll.id, member.id)}
    assert hist_cleared["Task 1"].is_selected is False
    assert hist_cleared["Task 2"].is_selected is False

    status = get_poll_status(db_session, poll.id)
    assert len(status.not_voted) == 1
    assert status.not_voted[0].id == member.id


# ---------------------------------------------------------------------------
# Test 5: Remove and re-add updates only last_selected_at
# ---------------------------------------------------------------------------
def test_5_remove_and_readd_history_timestamps(db_session):
    """Remove and re-add: after removing all selections the member is in not_voted, history keeps the earlier times, and re-adding updates only last_selected_at."""
    group = create_group(db_session, "Team E")
    member = add_member(db_session, group.id, "Alice")
    poll = create_poll(
        db_session,
        group_id=group.id,
        name="Task Poll",
        allow_multiple=False,
        options=[
            PollOptionInput(label="Done", role="target"),
            PollOptionInput(label="Skip", role="excused"),
        ],
    )
    opt_done = poll.options[0]

    t1 = dt(9, 0)
    t2 = dt(11, 0)

    cast_vote(db_session, poll.id, member.id, opt_done.id, now=t1)
    remove_vote(db_session, poll.id, member.id, option_id=None)

    status = get_poll_status(db_session, poll.id)
    assert len(status.not_voted) == 1
    assert status.not_voted[0].id == member.id

    hist_mid = get_member_history(db_session, poll.id, member.id)[0]
    assert hist_mid.first_selected_at == t1
    assert hist_mid.last_selected_at == t1
    assert hist_mid.is_selected is False

    # Re-add option at t2
    cast_vote(db_session, poll.id, member.id, opt_done.id, now=t2)
    hist_final = get_member_history(db_session, poll.id, member.id)[0]
    assert hist_final.first_selected_at == t1  # Kept earlier time
    assert hist_final.last_selected_at == t2   # Updated to new time
    assert hist_final.is_selected is True


# ---------------------------------------------------------------------------
# Test 6: Defaulter lists with all 4 categories present
# ---------------------------------------------------------------------------
def test_6_four_status_categories_present(db_session):
    """Defaulter lists for a small group with all four categories present, including an excused member who is not a defaulter."""
    group = create_group(db_session, "Team F")
    alice = add_member(db_session, group.id, "Alice")
    bob = add_member(db_session, group.id, "Bob")
    charlie = add_member(db_session, group.id, "Charlie")
    dana = add_member(db_session, group.id, "Dana")

    poll = create_poll(
        db_session,
        group_id=group.id,
        name="Sprint Review",
        allow_multiple=False,
        options=[
            PollOptionInput(label="Completed", role="target"),
            PollOptionInput(label="On Leave", role="excused"),
            PollOptionInput(label="Working", role="in_progress"),
            PollOptionInput(label="Not Started", role="not_yet"),
        ],
    )
    opts = {o.role: o for o in poll.options}

    cast_vote(db_session, poll.id, alice.id, opts["target"].id, now=dt(10, 0))
    cast_vote(db_session, poll.id, bob.id, opts["excused"].id, now=dt(10, 0))
    cast_vote(db_session, poll.id, charlie.id, opts["in_progress"].id, now=dt(10, 0))
    # Dana does not vote

    status = get_poll_status(db_session, poll.id)

    assert [m.id for m in status.at_target] == [alice.id]
    assert [m.id for m in status.excused] == [bob.id]  # Excused, not behind/defaulter
    assert [m.id for m in status.behind_target] == [charlie.id]
    assert [m.id for m in status.not_voted] == [dana.id]


# ---------------------------------------------------------------------------
# Test 7: Precedence of categories in multiple-choice
# ---------------------------------------------------------------------------
def test_7_category_order_in_multiple_choice(db_session):
    """Category order in a multiple-choice poll: target beats excused, excused beats not_yet, and someone with both in_progress and not_yet selected is in behind_target."""
    group = create_group(db_session, "Team G")
    m1 = add_member(db_session, group.id, "Member1")
    m2 = add_member(db_session, group.id, "Member2")
    m3 = add_member(db_session, group.id, "Member3")

    poll = create_poll(
        db_session,
        group_id=group.id,
        name="Multi Priority",
        allow_multiple=True,
        options=[
            PollOptionInput(label="Target Option", role="target"),
            PollOptionInput(label="Excused Option", role="excused"),
            PollOptionInput(label="In Progress Option", role="in_progress"),
            PollOptionInput(label="Not Yet Option", role="not_yet"),
        ],
    )
    opts = {o.role: o for o in poll.options}

    # Member 1: Target + Excused -> target beats excused
    cast_vote(db_session, poll.id, m1.id, opts["target"].id, now=dt(10, 0))
    cast_vote(db_session, poll.id, m1.id, opts["excused"].id, now=dt(10, 0))

    # Member 2: Excused + Not Yet -> excused beats not_yet
    cast_vote(db_session, poll.id, m2.id, opts["excused"].id, now=dt(10, 0))
    cast_vote(db_session, poll.id, m2.id, opts["not_yet"].id, now=dt(10, 0))

    # Member 3: In Progress + Not Yet -> behind_target
    cast_vote(db_session, poll.id, m3.id, opts["in_progress"].id, now=dt(10, 0))
    cast_vote(db_session, poll.id, m3.id, opts["not_yet"].id, now=dt(10, 0))

    status = get_poll_status(db_session, poll.id)

    assert m1.id in [e.id for e in status.at_target]
    assert m2.id in [e.id for e in status.excused]
    assert m3.id in [e.id for e in status.behind_target]


# ---------------------------------------------------------------------------
# Test 8: Stage-style poll
# ---------------------------------------------------------------------------
def test_8_stage_style_poll(db_session):
    """A stage-style poll (Part 1, Part 2, Part 3 completed; Part 3 is the target): members at Part 1 and Part 2 appear in behind_target, at Part 3 in at_target."""
    group = create_group(db_session, "Team H")
    m1 = add_member(db_session, group.id, "Alice")
    m2 = add_member(db_session, group.id, "Bob")
    m3 = add_member(db_session, group.id, "Charlie")

    poll = create_poll(
        db_session,
        group_id=group.id,
        name="Project Milestones",
        allow_multiple=False,
        options=[
            PollOptionInput(label="Part 1 completed", role="in_progress"),
            PollOptionInput(label="Part 2 completed", role="in_progress"),
            PollOptionInput(label="Part 3 completed", role="target"),
        ],
    )
    opts = {o.label: o for o in poll.options}

    cast_vote(db_session, poll.id, m1.id, opts["Part 1 completed"].id, now=dt(10, 0))
    cast_vote(db_session, poll.id, m2.id, opts["Part 2 completed"].id, now=dt(10, 0))
    cast_vote(db_session, poll.id, m3.id, opts["Part 3 completed"].id, now=dt(10, 0))

    status = get_poll_status(db_session, poll.id)

    behind_ids = {m.id for m in status.behind_target}
    assert m1.id in behind_ids
    assert m2.id in behind_ids
    assert [m.id for m in status.at_target] == [m3.id]


# ---------------------------------------------------------------------------
# Test 9: Completion time and lateness in first and last modes, and multiple targets
# ---------------------------------------------------------------------------
def test_9_lateness_modes_and_multiple_targets(db_session):
    """
    Lateness in both 'first' and 'last' modes: same member, two different results,
    with a deadline between the times.
    Also a multiple-choice case with two target options selected: completed_at is the earliest.
    """
    group = create_group(db_session, "Team I")
    member = add_member(db_session, group.id, "Alice")

    deadline = dt(12, 0)
    t_early = dt(10, 0)   # Before deadline
    t_switch = dt(11, 0)
    t_late = dt(14, 0)    # After deadline

    # Mode = "first"
    poll_first = create_poll(
        db_session,
        group_id=group.id,
        name="Poll First Mode",
        allow_multiple=False,
        deadline=deadline,
        completion_time_mode="first",
        options=[
            PollOptionInput(label="Finished", role="target"),
            PollOptionInput(label="Working", role="in_progress"),
        ],
    )
    f_done, f_work = poll_first.options[0], poll_first.options[1]
    cast_vote(db_session, poll_first.id, member.id, f_done.id, now=t_early)
    cast_vote(db_session, poll_first.id, member.id, f_work.id, now=t_switch)
    cast_vote(db_session, poll_first.id, member.id, f_done.id, now=t_late)

    status_first = get_poll_status(db_session, poll_first.id)
    entry_first = status_first.at_target[0]
    assert entry_first.completed_at == t_early
    assert entry_first.late is False  # 10:00 <= 12:00 -> not late!

    # Mode = "last"
    poll_last = create_poll(
        db_session,
        group_id=group.id,
        name="Poll Last Mode",
        allow_multiple=False,
        deadline=deadline,
        completion_time_mode="last",
        options=[
            PollOptionInput(label="Finished", role="target"),
            PollOptionInput(label="Working", role="in_progress"),
        ],
    )
    l_done, l_work = poll_last.options[0], poll_last.options[1]
    cast_vote(db_session, poll_last.id, member.id, l_done.id, now=t_early)
    cast_vote(db_session, poll_last.id, member.id, l_work.id, now=t_switch)
    cast_vote(db_session, poll_last.id, member.id, l_done.id, now=t_late)

    status_last = get_poll_status(db_session, poll_last.id)
    entry_last = status_last.at_target[0]
    assert entry_last.completed_at == t_late
    assert entry_last.late is True  # 14:00 > 12:00 -> late!

    # Multiple-choice case with two target options selected: earliest timestamp wins
    poll_multi_target = create_poll(
        db_session,
        group_id=group.id,
        name="Multi Target Poll",
        allow_multiple=True,
        deadline=deadline,
        completion_time_mode="last",
        options=[
            PollOptionInput(label="Goal 1", role="target"),
            PollOptionInput(label="Goal 2", role="target"),
        ],
    )
    g1, g2 = poll_multi_target.options[0], poll_multi_target.options[1]
    t_g1 = dt(13, 0)
    t_g2 = dt(9, 0)  # Earliest
    cast_vote(db_session, poll_multi_target.id, member.id, g1.id, now=t_g1)
    cast_vote(db_session, poll_multi_target.id, member.id, g2.id, now=t_g2)

    status_multi = get_poll_status(db_session, poll_multi_target.id)
    entry_multi = status_multi.at_target[0]
    assert entry_multi.completed_at == t_g2
    assert entry_multi.late is False  # 09:00 <= 12:00


# ---------------------------------------------------------------------------
# Test 10: all_reached state calculations
# ---------------------------------------------------------------------------
def test_10_all_reached_scenarios(db_session):
    """all_reached is false with a missing voter, true when everyone is at target, true when the only remaining member is excused, false when everyone is excused, false with zero members."""
    group = create_group(db_session, "Team J")
    m1 = add_member(db_session, group.id, "Alice")
    m2 = add_member(db_session, group.id, "Bob")

    poll = create_poll(
        db_session,
        group_id=group.id,
        name="Completion Check",
        allow_multiple=False,
        options=[
            PollOptionInput(label="Target", role="target"),
            PollOptionInput(label="Excused", role="excused"),
            PollOptionInput(label="Pending", role="in_progress"),
        ],
    )
    opt_target = poll.options[0]
    opt_excused = poll.options[1]

    # Scenario A: Missing voter (m1 at target, m2 has not voted) -> False
    cast_vote(db_session, poll.id, m1.id, opt_target.id, now=dt(10, 0))
    assert all_reached(db_session, poll.id) is False

    # Scenario B: Everyone is at target -> True
    cast_vote(db_session, poll.id, m2.id, opt_target.id, now=dt(10, 0))
    assert all_reached(db_session, poll.id) is True

    # Scenario C: Only remaining member is excused -> True
    cast_vote(db_session, poll.id, m2.id, opt_excused.id, now=dt(10, 0))
    assert all_reached(db_session, poll.id) is True

    # Scenario D: Everyone is excused (0 at target) -> False
    cast_vote(db_session, poll.id, m1.id, opt_excused.id, now=dt(10, 0))
    assert all_reached(db_session, poll.id) is False

    # Scenario E: Zero active members in group -> False
    empty_group = create_group(db_session, "Empty Group")
    empty_poll = create_poll(
        db_session,
        group_id=empty_group.id,
        name="Empty Poll",
        allow_multiple=False,
        options=[
            PollOptionInput(label="A", role="target"),
            PollOptionInput(label="B", role="not_yet"),
        ],
    )
    assert all_reached(db_session, empty_poll.id) is False


# ---------------------------------------------------------------------------
# Test 11: Closed poll behavior
# ---------------------------------------------------------------------------
def test_11_closed_poll_behavior(db_session):
    """Closed poll rejects votes and removals; closing twice is fine; reads still work after closing."""
    group = create_group(db_session, "Team K")
    member = add_member(db_session, group.id, "Alice")
    poll = create_poll(
        db_session,
        group_id=group.id,
        name="Closing Poll",
        allow_multiple=False,
        options=[
            PollOptionInput(label="Done", role="target"),
            PollOptionInput(label="Not Done", role="not_yet"),
        ],
    )
    opt_done = poll.options[0]

    cast_vote(db_session, poll.id, member.id, opt_done.id, now=dt(10, 0))

    t_close = dt(12, 0)
    closed_poll = close_poll(db_session, poll.id, now=t_close)
    assert closed_poll.status == "closed"
    assert closed_poll.closed_at == t_close

    # Closing again changes nothing and does not error
    closed_again = close_poll(db_session, poll.id, now=dt(13, 0))
    assert closed_again.status == "closed"
    assert closed_again.closed_at == t_close

    # Votes and removals are rejected
    with pytest.raises(PollClosedError):
        cast_vote(db_session, poll.id, member.id, poll.options[1].id, now=dt(13, 0))

    with pytest.raises(PollClosedError):
        remove_vote(db_session, poll.id, member.id, option_id=opt_done.id)

    # Reads still work
    status = get_poll_status(db_session, poll.id)
    assert len(status.at_target) == 1
    assert status.at_target[0].id == member.id

    history = get_member_history(db_session, poll.id, member.id)
    assert len(history) == 1
    assert history[0].is_selected is True

    assert all_reached(db_session, poll.id) is True


# ---------------------------------------------------------------------------
# Test 12: Validation errors
# ---------------------------------------------------------------------------
def test_12_validation_and_integrity_errors(db_session):
    """Validation errors: fewer than 2 options, duplicate labels, no target option, member from another group, option from another poll, inactive member."""
    group1 = create_group(db_session, "Group 1")
    group2 = create_group(db_session, "Group 2")

    active_m1 = add_member(db_session, group1.id, "Active M1")
    inactive_m1 = add_member(db_session, group1.id, "Inactive M1", is_active=False)
    m2 = add_member(db_session, group2.id, "Group 2 Member")

    # 1. Fewer than 2 options
    with pytest.raises(PollValidationError, match="at least 2 options"):
        create_poll(
            db_session,
            group_id=group1.id,
            name="Single Option Poll",
            allow_multiple=False,
            options=[PollOptionInput(label="Only One", role="target")],
        )

    # 2. Duplicate labels
    with pytest.raises(PollValidationError, match="Duplicate option label"):
        create_poll(
            db_session,
            group_id=group1.id,
            name="Duplicate Option Poll",
            allow_multiple=False,
            options=[
                PollOptionInput(label="Same", role="target"),
                PollOptionInput(label="Same", role="not_yet"),
            ],
        )

    # 3. No target option
    with pytest.raises(PollValidationError, match="at least one option with role 'target'"):
        create_poll(
            db_session,
            group_id=group1.id,
            name="No Target Poll",
            allow_multiple=False,
            options=[
                PollOptionInput(label="A", role="in_progress"),
                PollOptionInput(label="B", role="not_yet"),
            ],
        )

    # Create valid poll in group1
    poll1 = create_poll(
        db_session,
        group_id=group1.id,
        name="Valid Poll 1",
        allow_multiple=False,
        options=[
            PollOptionInput(label="Target 1", role="target"),
            PollOptionInput(label="Pending 1", role="in_progress"),
        ],
    )

    # Create valid poll in group2
    poll2 = create_poll(
        db_session,
        group_id=group2.id,
        name="Valid Poll 2",
        allow_multiple=False,
        options=[
            PollOptionInput(label="Target 2", role="target"),
            PollOptionInput(label="Pending 2", role="in_progress"),
        ],
    )

    # 4. Member from another group
    with pytest.raises(MemberGroupMismatchError):
        cast_vote(db_session, poll1.id, m2.id, poll1.options[0].id)

    # 5. Option from another poll
    with pytest.raises(OptionPollMismatchError):
        cast_vote(db_session, poll1.id, active_m1.id, poll2.options[0].id)

    # 6. Inactive member
    with pytest.raises(MemberInactiveError):
        cast_vote(db_session, poll1.id, inactive_m1.id, poll1.options[0].id)
