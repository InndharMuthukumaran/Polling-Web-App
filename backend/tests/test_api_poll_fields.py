"""Tests for Part R3: Poll columns, poll-only fields, answers, and results export (HTTP API)."""

from datetime import datetime, timedelta, timezone
import io
import csv
import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.db import Base
from app.main import app
from app.models import Group, Member
from app.services.identity import create_group_with_admin
from app.services.fields import create_group_field


def test_api_create_poll_fields_and_included_fields(client):
    """Test 2 & 8: Creating poll via API with included fields and poll-only fields, plus public visibility."""
    # 1. Create group with admin
    res = client.post("/api/v1/groups", json={"name": "Science Club"})
    assert res.status_code == 201
    group_data = res.json()
    group_id = group_data["group_id"]
    admin_token = group_data["admin_token"]
    headers = {"X-Admin-Token": admin_token}

    # 2. Add group fields
    f_id = client.post(
        f"/api/v1/groups/{group_id}/fields",
        headers=headers,
        json={"name": "StudentID", "field_type": "text"},
    ).json()["id"]
    client.patch(
        f"/api/v1/groups/{group_id}/fields/{f_id}",
        headers=headers,
        json={"is_identifier": True},
    )

    f_sub = client.post(
        f"/api/v1/groups/{group_id}/fields",
        headers=headers,
        json={"name": "Major", "field_type": "text"},
    ).json()["id"]

    # 3. Create poll with included group fields and poll-only fields
    poll_payload = {
        "name": "Physics Seminar",
        "allow_multiple": False,
        "options": [
            {"label": "Attending", "role": "target"},
            {"label": "Can't make it", "role": "excused"},
        ],
        "included_field_ids": [f_sub, f_id],  # f_id is identifier -> ignored in included_fields
        "poll_fields": [
            {
                "name": "Food Choice",
                "field_type": "choice",
                "choices": ["Veg", "Non-veg"],
                "default_value": "Veg",
            },
            {
                "name": "Dietary Notes",
                "field_type": "text",
                "is_required": False,
            },
        ],
    }

    create_res = client.post(
        f"/api/v1/groups/{group_id}/polls",
        headers=headers,
        json=poll_payload,
    )
    assert create_res.status_code == 201, create_res.text
    poll_resp = create_res.json()
    poll_id = poll_resp["id"]

    # Check included_fields in response (only Major, f_id identifier is excluded)
    assert len(poll_resp["included_fields"]) == 1
    assert poll_resp["included_fields"][0]["id"] == f_sub
    assert poll_resp["included_fields"][0]["name"] == "Major"

    # Check poll_fields in response
    assert len(poll_resp["poll_fields"]) == 2
    assert poll_resp["poll_fields"][0]["name"] == "Food Choice"
    assert poll_resp["poll_fields"][0]["key"] == "food_choice"
    assert poll_resp["poll_fields"][1]["name"] == "Dietary Notes"
    assert poll_resp["poll_fields"][1]["key"] == "dietary_notes"

    # Public GET /polls/{poll_id} shows poll_fields but NO included_fields
    pub_res = client.get(f"/api/v1/polls/{poll_id}")
    assert pub_res.status_code == 200
    pub_data = pub_res.json()
    assert "poll_fields" in pub_data
    assert len(pub_data["poll_fields"]) == 2
    assert pub_data["poll_fields"][0]["key"] == "food_choice"
    assert "included_fields" not in pub_data
    assert "included_field_ids" not in pub_data


def test_api_create_poll_validation_errors(client):
    """Test 2 (cont): API rejection of invalid poll creation payloads."""
    # Create Group A
    res_a = client.post("/api/v1/groups", json={"name": "Group A"})
    g_a = res_a.json()
    token_a = g_a["admin_token"]
    headers_a = {"X-Admin-Token": token_a}

    # Create Group B
    res_b = client.post("/api/v1/groups", json={"name": "Group B"})
    g_b = res_b.json()
    token_b = g_b["admin_token"]
    headers_b = {"X-Admin-Token": token_b}

    f_b = client.post(
        f"/api/v1/groups/{g_b['group_id']}/fields",
        headers=headers_b,
        json={"name": "GroupBField", "field_type": "text"},
    ).json()["id"]

    base_poll = {
        "name": "Validation Poll",
        "allow_multiple": False,
        "options": [{"label": "A", "role": "target"}, {"label": "B", "role": "not_yet"}],
    }

    # 1. Other group's field ID -> 422
    err_res1 = client.post(
        f"/api/v1/groups/{g_a['group_id']}/polls",
        headers=headers_a,
        json={**base_poll, "included_field_ids": [f_b]},
    )
    assert err_res1.status_code == 422

    # 2. Name clash with poll field (case-insensitive) -> 422
    err_res2 = client.post(
        f"/api/v1/groups/{g_a['group_id']}/polls",
        headers=headers_a,
        json={
            **base_poll,
            "poll_fields": [
                {"name": "Skill", "field_type": "text"},
                {"name": "skill", "field_type": "text"},
            ],
        },
    )
    assert err_res2.status_code == 422

    # 3. Over 15 fields -> 422
    err_res3 = client.post(
        f"/api/v1/groups/{g_a['group_id']}/polls",
        headers=headers_a,
        json={
            **base_poll,
            "poll_fields": [{"name": f"F{i}", "field_type": "text"} for i in range(16)],
        },
    )
    assert err_res3.status_code == 422


def test_api_answers_flow_and_guards(client):
    """Test 4, 5, 7, 8: Saving answers via PUT /polls/{id}/answers, partial update, blanks, member view, guards."""
    # Create group with member
    g = client.post("/api/v1/groups", json={"name": "Club"}).json()
    admin_headers = {"X-Admin-Token": g["admin_token"]}

    # Bulk add member
    members_resp = client.post(
        f"/api/v1/groups/{g['group_id']}/members",
        headers=admin_headers,
        json={"display_names": ["Alice", "Bob"]},
    ).json()
    alice_id = members_resp[0]["id"]

    # Claim Alice
    claim_res = client.post(
        f"/api/v1/join/{g['join_code']}/claim",
        json={"member_id": alice_id},
    )
    assert claim_res.status_code == 201
    alice_token = claim_res.json()["member_token"]
    alice_headers = {"X-Member-Token": alice_token}

    # Create poll
    poll = client.post(
        f"/api/v1/groups/{g['group_id']}/polls",
        headers=admin_headers,
        json={
            "name": "Event Poll",
            "allow_multiple": False,
            "options": [{"label": "Yes", "role": "target"}, {"label": "No", "role": "not_yet"}],
            "poll_fields": [
                {"name": "Transport", "field_type": "choice", "choices": ["Bus", "Train"], "default_value": "Bus"},
                {"name": "Emergency Contact", "field_type": "number", "is_required": True},
            ],
        },
    ).json()
    poll_id = poll["id"]

    # 1. No token gives 401
    no_auth_res = client.put(f"/api/v1/polls/{poll_id}/answers", json={"values": {"transport": "Train"}})
    assert no_auth_res.status_code == 401

    # 2. Member saves answers
    save_res = client.put(
        f"/api/v1/polls/{poll_id}/answers",
        headers=alice_headers,
        json={"values": {"transport": "Train", "emergency_contact": 9876543210}},
    )
    assert save_res.status_code == 200
    save_data = save_res.json()
    assert save_data["answers"]["transport"] == "Train"
    assert save_data["answers"]["emergency_contact"] == 9876543210
    assert save_data["answers_updated_at"] is not None

    # 3. GET /polls/{poll_id}/me returns member's answers
    me_res = client.get(f"/api/v1/polls/{poll_id}/me", headers=alice_headers)
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["answers"]["transport"] == "Train"
    assert me_data["answers"]["emergency_contact"] == 9876543210

    # 4. Invalid value gives 422 with field name in details
    inv_res = client.put(
        f"/api/v1/polls/{poll_id}/answers",
        headers=alice_headers,
        json={"values": {"transport": "Airplane"}},
    )
    assert inv_res.status_code == 422
    err_body = inv_res.json()["error"]
    assert err_body["details"][0]["field"] == "Transport"

    # 5. Unknown key gives 422 with details
    unk_res = client.put(
        f"/api/v1/polls/{poll_id}/answers",
        headers=alice_headers,
        json={"values": {"non_existent_key": "val"}},
    )
    assert unk_res.status_code == 422
    assert unk_res.json()["error"]["details"][0]["field"] == "non_existent_key"

    # 6. Partial update leaves other keys alone
    part_res = client.put(
        f"/api/v1/polls/{poll_id}/answers",
        headers=alice_headers,
        json={"values": {"emergency_contact": 1122334455}},
    )
    assert part_res.status_code == 200
    assert part_res.json()["answers"]["emergency_contact"] == 1122334455
    assert part_res.json()["answers"]["transport"] == "Train"

    # 7. Blank resets to default (for transport) and removes (for contact)
    reset_res = client.put(
        f"/api/v1/polls/{poll_id}/answers",
        headers=alice_headers,
        json={"values": {"transport": "", "emergency_contact": ""}},
    )
    assert reset_res.status_code == 200
    assert reset_res.json()["answers"]["transport"] == "Bus"  # reset to default
    assert "emergency_contact" not in reset_res.json()["answers"]  # removed

    # 8. Closed poll rejects answers with 409 poll_closed
    client.post(f"/api/v1/polls/{poll_id}/close", headers=admin_headers)
    closed_res = client.put(
        f"/api/v1/polls/{poll_id}/answers",
        headers=alice_headers,
        json={"values": {"transport": "Train"}},
    )
    assert closed_res.status_code == 409
    assert closed_res.json()["error"]["code"] == "poll_closed"


def test_api_results_json_export(client):
    """Test 9: Results JSON: all 4 statuses present, selected_options single & multi, late & completed_at, live values."""
    # Create group with identifier
    g = client.post("/api/v1/groups", json={"name": "Status Group"}).json()
    admin_headers = {"X-Admin-Token": g["admin_token"]}

    f_reg = client.post(
        f"/api/v1/groups/{g['group_id']}/fields",
        headers=admin_headers,
        json={"name": "RegNo", "field_type": "text"},
    ).json()["id"]
    client.patch(
        f"/api/v1/groups/{g['group_id']}/fields/{f_reg}",
        headers=admin_headers,
        json={"is_identifier": True},
    )
    gf_batch = client.post(
        f"/api/v1/groups/{g['group_id']}/fields",
        headers=admin_headers,
        json={"name": "Batch", "field_type": "text"},
    ).json()["id"]

    # Add 4 members
    members = client.post(
        f"/api/v1/groups/{g['group_id']}/members",
        headers=admin_headers,
        json={
            "members": [
                {"display_name": "Alice", "values": {"regno": "REG01", "batch": "2024"}},
                {"display_name": "Bob", "values": {"regno": "REG02", "batch": "2024"}},
                {"display_name": "Charlie", "values": {"regno": "REG03", "batch": "2025"}},
                {"display_name": "Dave", "values": {"regno": "REG04", "batch": "2025"}},
                {"display_name": "Inactive", "values": {"regno": "REG05", "batch": "2025"}},
            ]
        },
    ).json()

    # Deactivate 5th member
    client.patch(
        f"/api/v1/groups/{g['group_id']}/members/{members[4]['id']}",
        headers=admin_headers,
        json={"is_active": False},
    )

    # Claim tokens
    token_alice = client.post(f"/api/v1/join/{g['join_code']}/claim", json={"member_id": members[0]["id"]}).json()["member_token"]
    token_bob = client.post(f"/api/v1/join/{g['join_code']}/claim", json={"member_id": members[1]["id"]}).json()["member_token"]
    token_charlie = client.post(f"/api/v1/join/{g['join_code']}/claim", json={"member_id": members[2]["id"]}).json()["member_token"]

    # Past deadline for lateness test
    past_deadline = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()

    poll = client.post(
        f"/api/v1/groups/{g['group_id']}/polls",
        headers=admin_headers,
        json={
            "name": "Comprehensive Results Poll",
            "allow_multiple": True,
            "deadline": past_deadline,
            "options": [
                {"label": "OptTarget", "role": "target"},
                {"label": "OptExcused", "role": "excused"},
                {"label": "OptInProgress", "role": "in_progress"},
            ],
            "included_field_ids": [gf_batch],
            "poll_fields": [{"name": "Feedback", "field_type": "text"}],
        },
    ).json()
    poll_id = poll["id"]
    opt_target = poll["options"][0]["id"]
    opt_excused = poll["options"][1]["id"]
    opt_in_prog = poll["options"][2]["id"]

    # Alice votes Target (completed after deadline -> late=True)
    client.post(f"/api/v1/polls/{poll_id}/vote", headers={"X-Member-Token": token_alice}, json={"option_id": opt_target})
    # Bob votes Excused
    client.post(f"/api/v1/polls/{poll_id}/vote", headers={"X-Member-Token": token_bob}, json={"option_id": opt_excused})
    # Charlie votes InProgress
    client.post(f"/api/v1/polls/{poll_id}/vote", headers={"X-Member-Token": token_charlie}, json={"option_id": opt_in_prog})
    # Dave does not vote

    # Alice also saves answer
    client.put(f"/api/v1/polls/{poll_id}/answers", headers={"X-Member-Token": token_alice}, json={"values": {"feedback": "Great!"}})

    # Fetch results as admin
    res = client.get(f"/api/v1/polls/{poll_id}/results?format=json", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()

    assert data["poll"]["name"] == "Comprehensive Results Poll"
    # Columns check: RegNo (identifier), Batch, Feedback
    cols = data["columns"]
    assert len(cols) == 3
    assert cols[0]["name"] == "RegNo"
    assert cols[0]["is_identifier"] is True
    assert cols[1]["name"] == "Batch"
    assert cols[2]["name"] == "Feedback"

    # Inactive member excluded -> exactly 4 rows
    rows = data["rows"]
    assert len(rows) == 4
    row_by_name = {r["display_name"]: r for r in rows}

    # All 4 statuses present
    assert row_by_name["Alice"]["status"] == "at_target"
    assert row_by_name["Alice"]["late"] is True
    assert row_by_name["Alice"]["completed_at"] is not None
    assert row_by_name["Alice"]["selected_options"] == ["OptTarget"]
    assert row_by_name["Alice"]["answers"]["feedback"] == "Great!"
    assert row_by_name["Alice"]["group_values"]["regno"] == "REG01"

    assert row_by_name["Bob"]["status"] == "excused"
    assert row_by_name["Bob"]["late"] is None
    assert row_by_name["Bob"]["selected_options"] == ["OptExcused"]

    assert row_by_name["Charlie"]["status"] == "behind_target"
    assert row_by_name["Charlie"]["late"] is None
    assert row_by_name["Charlie"]["selected_options"] == ["OptInProgress"]

    assert row_by_name["Dave"]["status"] == "not_voted"
    assert row_by_name["Dave"]["late"] is None
    assert row_by_name["Dave"]["selected_options"] == []


def test_api_results_csv_and_xlsx_download(client):
    """Test 10: CSV and Excel endpoint downloads, auth guards, BOM, formulas, data types."""
    g = client.post("/api/v1/groups", json={"name": "Export Club"}).json()
    admin_headers = {"X-Admin-Token": g["admin_token"]}

    f_tag = client.post(
        f"/api/v1/groups/{g['group_id']}/fields",
        headers=admin_headers,
        json={"name": "Tag", "field_type": "text"},
    ).json()["id"]
    client.patch(
        f"/api/v1/groups/{g['group_id']}/fields/{f_tag}",
        headers=admin_headers,
        json={"is_identifier": True},
    )

    client.post(
        f"/api/v1/groups/{g['group_id']}/members",
        headers=admin_headers,
        json={"members": [{"display_name": "Member1", "values": {"tag": "=DANGEROUS_FORMULA"}}]},
    )

    poll = client.post(
        f"/api/v1/groups/{g['group_id']}/polls",
        headers=admin_headers,
        json={
            "name": "Export Sample Poll",
            "allow_multiple": False,
            "options": [{"label": "Yes", "role": "target"}, {"label": "No", "role": "not_yet"}],
            "poll_fields": [{"name": "Score", "field_type": "number"}],
        },
    ).json()
    poll_id = poll["id"]

    # 1. Auth guards
    # No token -> 401
    no_auth = client.get(f"/api/v1/polls/{poll_id}/results?format=csv")
    assert no_auth.status_code == 401

    # Other group's token -> 403
    other_g = client.post("/api/v1/groups", json={"name": "Other Club"}).json()
    other_headers = {"X-Admin-Token": other_g["admin_token"]}
    forbidden_res = client.get(f"/api/v1/polls/{poll_id}/results?format=csv", headers=other_headers)
    assert forbidden_res.status_code == 403

    # 2. Download CSV
    csv_res = client.get(f"/api/v1/polls/{poll_id}/results?format=csv", headers=admin_headers)
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers["content-type"]
    assert "attachment; filename=\"Export_Sample_Poll.csv\"" in csv_res.headers["content-disposition"]
    csv_content = csv_res.content
    assert csv_content.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM

    csv_text = csv_content.decode("utf-8-sig")
    reader = list(csv.reader(io.StringIO(csv_text)))
    assert reader[0] == [
        "Name",
        "Tag",
        "Score",
        "Status",
        "Selected options",
        "Late",
        "Completed at",
        "Answers complete",
    ]
    # Check formula cell in CSV has leading single quote
    assert reader[1][1] == "'=DANGEROUS_FORMULA"

    # 3. Download Excel
    xlsx_res = client.get(f"/api/v1/polls/{poll_id}/results?format=xlsx", headers=admin_headers)
    assert xlsx_res.status_code == 200
    assert "spreadsheetml" in xlsx_res.headers["content-type"]
    assert "attachment; filename=\"Export_Sample_Poll.xlsx\"" in xlsx_res.headers["content-disposition"]

    wb = openpyxl.load_workbook(io.BytesIO(xlsx_res.content))
    ws = wb.active
    # Formula in Tag cell has leading single quote and string data type
    tag_cell = ws.cell(row=2, column=2)
    assert tag_cell.value == "'=DANGEROUS_FORMULA"
    assert tag_cell.data_type == "s"
