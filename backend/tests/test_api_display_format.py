"""API tests for Part C1: Display format endpoints, join public labels, and spreadsheet importer."""

import csv
import io
import json
from uuid import UUID

import openpyxl
import pytest
from starlette.testclient import TestClient


def make_xlsx(rows: list[list]) -> bytes:
    """Helper to generate in-memory xlsx file bytes."""
    wb = openpyxl.Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def make_csv(rows: list[list]) -> bytes:
    """Helper to generate in-memory csv file bytes."""
    out = io.StringIO()
    writer = csv.writer(out)
    for r in rows:
        writer.writerow(r)
    return out.getvalue().encode("utf-8")


# ---------------------------------------------------------------------------
# 1. GET /groups/{id} and PATCH /groups/{id}
# ---------------------------------------------------------------------------
def test_group_display_format_get_and_patch(client: TestClient):
    """
    GET /groups/{id}: adds display_format, fields have is_builtin, members have _name in values.
    PATCH /groups/{id}: accepts display_format alone or together with settings.
    At least one setting must be provided.
    Wrong token or another group's token gets 401 / 403.
    """
    # Create Group A
    res_a = client.post("/api/v1/groups", json={"name": "API Group A"})
    assert res_a.status_code == 201
    g_a = res_a.json()
    gid_a = g_a["group_id"]
    tok_a = g_a["admin_token"]

    # Create Group B
    res_b = client.post("/api/v1/groups", json={"name": "API Group B"})
    assert res_b.status_code == 201
    tok_b = res_b.json()["admin_token"]

    # 1. GET /groups/{id}
    res = client.get(f"/api/v1/groups/{gid_a}", headers={"X-Admin-Token": tok_a})
    assert res.status_code == 200
    data = res.json()
    assert data["display_format"] == {"parts": ["_name"], "separator": " - "}
    assert len(data["fields"]) >= 1
    assert data["fields"][0]["is_builtin"] is True
    assert data["fields"][0]["key"] == "_name"

    # Add custom field
    f_res = client.post(
        f"/api/v1/groups/{gid_a}/fields",
        headers={"X-Admin-Token": tok_a},
        json={"name": "RegNo", "field_type": "text"},
    )
    assert f_res.status_code == 201
    f_key = f_res.json()["key"]

    # Add member
    m_res = client.post(
        f"/api/v1/groups/{gid_a}/members",
        headers={"X-Admin-Token": tok_a},
        json={"members": [{"display_name": "Asha", "values": {f_key: "21001"}}]},
    )
    assert m_res.status_code == 201
    assert m_res.json()[0]["values"]["_name"] == "Asha"

    # 2. PATCH auth checks
    # Missing token -> 401
    res_patch_no_tok = client.patch(
        f"/api/v1/groups/{gid_a}",
        json={"display_format": {"parts": ["_name", f_key], "separator": " | "}},
    )
    assert res_patch_no_tok.status_code == 401

    # Wrong group token -> 403
    res_patch_forbidden = client.patch(
        f"/api/v1/groups/{gid_a}",
        headers={"X-Admin-Token": tok_b},
        json={"display_format": {"parts": ["_name", f_key], "separator": " | "}},
    )
    assert res_patch_forbidden.status_code == 403

    # Empty payload -> 422 (must provide at least one setting)
    res_empty_patch = client.patch(
        f"/api/v1/groups/{gid_a}",
        headers={"X-Admin-Token": tok_a},
        json={},
    )
    assert res_empty_patch.status_code == 422

    # 3. PATCH display_format alone
    res_patch = client.patch(
        f"/api/v1/groups/{gid_a}",
        headers={"X-Admin-Token": tok_a},
        json={"display_format": {"parts": ["_name", f_key], "separator": " | "}},
    )
    assert res_patch.status_code == 200
    assert res_patch.json()["display_format"] == {"parts": ["_name", f_key], "separator": " | "}

    # Verify member display_name was recomputed
    res_get = client.get(f"/api/v1/groups/{gid_a}", headers={"X-Admin-Token": tok_a})
    member_data = res_get.json()["members"][0]
    assert member_data["display_name"] == "Asha | 21001"

    # 4. PATCH display_format together with other settings
    res_patch_multi = client.patch(
        f"/api/v1/groups/{gid_a}",
        headers={"X-Admin-Token": tok_a},
        json={
            "allow_name_list": True,
            "require_claim_approval": True,
            "display_format": {"parts": [f_key, "_name"], "separator": " : "},
        },
    )
    assert res_patch_multi.status_code == 200
    assert res_patch_multi.json()["allow_name_list"] is True
    assert res_patch_multi.json()["require_claim_approval"] is True
    assert res_patch_multi.json()["display_format"] == {"parts": [f_key, "_name"], "separator": " : "}


# ---------------------------------------------------------------------------
# 2. Field endpoints built-in protections
# ---------------------------------------------------------------------------
def test_field_endpoints_builtin_rules(client: TestClient):
    """
    DELETE on built-in field returns 422 'The Name field cannot be deleted.'
    PATCH with is_identifier: true on built-in returns 422 'The Name field cannot be the identifier.'
    DELETE on field referenced in display_format returns 422 'Remove it from the display name first.'
    Renaming built-in field succeeds.
    """
    res = client.post("/api/v1/groups", json={"name": "Fields Rules Group"})
    gid = res.json()["group_id"]
    token = res.json()["admin_token"]

    fields = client.get(f"/api/v1/groups/{gid}/fields", headers={"X-Admin-Token": token}).json()
    builtin_f = next(f for f in fields if f["is_builtin"])
    builtin_id = builtin_f["id"]

    # 1. DELETE built-in field -> 422
    del_res = client.delete(
        f"/api/v1/groups/{gid}/fields/{builtin_id}",
        headers={"X-Admin-Token": token},
    )
    assert del_res.status_code == 422
    assert "The Name field cannot be deleted." in del_res.json()["error"]["message"]

    # 2. PATCH is_identifier: true on built-in -> 422
    patch_id_res = client.patch(
        f"/api/v1/groups/{gid}/fields/{builtin_id}",
        headers={"X-Admin-Token": token},
        json={"is_identifier": True},
    )
    assert patch_id_res.status_code == 422
    assert "The Name field cannot be the identifier." in patch_id_res.json()["error"]["message"]

    # 3. Rename built-in field -> 200
    rename_res = client.patch(
        f"/api/v1/groups/{gid}/fields/{builtin_id}",
        headers={"X-Admin-Token": token},
        json={"name": "Participant Name"},
    )
    assert rename_res.status_code == 200
    assert rename_res.json()["name"] == "Participant Name"

    # 4. Create custom field, put in format, try to delete -> 422
    f_res = client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "Role", "field_type": "text"},
    )
    role_id = f_res.json()["id"]
    role_key = f_res.json()["key"]

    client.patch(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": token},
        json={"display_format": {"parts": ["_name", role_key], "separator": " - "}},
    )

    del_role_res = client.delete(
        f"/api/v1/groups/{gid}/fields/{role_id}",
        headers={"X-Admin-Token": token},
    )
    assert del_role_res.status_code == 422
    assert "Remove it from the display name first." in del_role_res.json()["error"]["message"]


# ---------------------------------------------------------------------------
# 3. GET /join/{join_code} public label and lookup
# ---------------------------------------------------------------------------
def test_join_public_display_name_and_lookup(client: TestClient):
    """
    GET /join/{join_code}:
    - members list uses public display name (masked identifier in format).
    - if identifier NOT in format, public label equals display name.
    POST /join/{join_code}/lookup:
    - returns full display name of member who typed their own identifier.
    - returns display_name=None for taken member.
    """
    res = client.post("/api/v1/groups", json={"name": "Join Public Group"})
    gid = res.json()["group_id"]
    token = res.json()["admin_token"]
    join_code = res.json()["join_code"]

    # Create identifier field
    f_res = client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "RegNo", "field_type": "text"},
    )
    reg_key = f_res.json()["key"]
    client.patch(
        f"/api/v1/groups/{gid}/fields/{f_res.json()['id']}",
        headers={"X-Admin-Token": token},
        json={"is_identifier": True},
    )

    # Allow name list and set format with identifier
    client.patch(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": token},
        json={
            "allow_name_list": True,
            "display_format": {"parts": ["_name", reg_key], "separator": " - "},
        },
    )

    # Add member: Name="Asha K", RegNo="21001"
    client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={"members": [{"display_name": "Asha K", "values": {reg_key: "21001"}}]},
    )

    # 1. GET /join/{join_code}: public display name has masked identifier
    join_res = client.get(f"/api/v1/join/{join_code}")
    assert join_res.status_code == 200
    m_info = join_res.json()["members"][0]
    # '21001' (len 5 >= 4): masked to '•••001'
    assert m_info["display_name"] == "Asha K - •••001"

    # 2. Lookup by typed identifier returns full display name
    lookup_res = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": "21001"},
    )
    assert lookup_res.status_code == 200
    assert lookup_res.json()["display_name"] == "Asha K - 21001"
    assert lookup_res.json()["taken"] is False
    m_id = lookup_res.json()["member_id"]

    # 3. Claim member
    claim_res = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": m_id},
    )
    assert claim_res.status_code == 201

    # Now lookup returns taken: True, display_name: None
    lookup_taken = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": "21001"},
    )
    assert lookup_taken.status_code == 200
    assert lookup_taken.json()["taken"] is True
    assert lookup_taken.json()["display_name"] is None


# ---------------------------------------------------------------------------
# 4. Importer with display_format and column references
# ---------------------------------------------------------------------------
def test_import_with_display_format_and_col_references(client: TestClient):
    """
    Spreadsheet without Name column:
    - imported with display_format using 'col:<idx>' references;
    - resolves references to real keys;
    - saves display_format atomically with members;
    - reports display_format_saved: true;
    - dry run validates format without saving.
    """
    res = client.post("/api/v1/groups", json={"name": "Import Format Group"})
    gid = res.json()["group_id"]
    token = res.json()["admin_token"]

    # Spreadsheet has columns: First Name, Last Name, Score
    # We will turn col 0 into "FirstName", col 1 into "LastName", col 2 into "Score"
    file_bytes = make_xlsx([
        ["First Name", "Last Name", "Score"],
        ["John", "Doe", 95],
        ["Jane", "Smith", 98],
    ])

    new_fields_spec = [
        {"column": 0, "name": "First Name", "field_type": "text"},
        {"column": 1, "name": "Last Name", "field_type": "text"},
        {"column": 2, "name": "Score", "field_type": "number"},
    ]
    df_spec = {
        "parts": ["col:0", "col:1"],
        "separator": ", ",
    }

    # 1. Dry run
    res_dry = client.post(
        f"/api/v1/groups/{gid}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.xlsx", file_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={
            "mapping": json.dumps({"0": "skip", "1": "skip", "2": "skip"}),
            "new_fields": json.dumps(new_fields_spec),
            "display_format": json.dumps(df_spec),
            "dry_run": "true",
        },
    )
    assert res_dry.status_code == 200
    dry_data = res_dry.json()
    assert dry_data["dry_run"] is True
    assert dry_data["rows_added"] == 2
    assert dry_data["display_format_saved"] is False

    # Verify nothing was saved
    g_check = client.get(f"/api/v1/groups/{gid}", headers={"X-Admin-Token": token}).json()
    assert len(g_check["members"]) == 0
    assert g_check["display_format"] == {"parts": ["_name"], "separator": " - "}

    # 2. Actual import
    res_act = client.post(
        f"/api/v1/groups/{gid}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.xlsx", file_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={
            "mapping": json.dumps({"0": "skip", "1": "skip", "2": "skip"}),
            "new_fields": json.dumps(new_fields_spec),
            "display_format": json.dumps(df_spec),
            "dry_run": "false",
        },
    )
    assert res_act.status_code == 200
    act_data = res_act.json()
    assert act_data["dry_run"] is False
    assert act_data["rows_added"] == 2
    assert act_data["display_format_saved"] is True

    # Verify group and members
    g_final = client.get(f"/api/v1/groups/{gid}", headers={"X-Admin-Token": token}).json()
    f_first = next(f for f in g_final["fields"] if f["name"] == "First Name")
    f_last = next(f for f in g_final["fields"] if f["name"] == "Last Name")
    assert g_final["display_format"] == {"parts": [f_first["key"], f_last["key"]], "separator": ", "}

    members = g_final["members"]
    assert len(members) == 2
    names = [m["display_name"] for m in members]
    assert "John, Doe" in names
    assert "Jane, Smith" in names


# ---------------------------------------------------------------------------
# 5. Importer validation: row numbers and mapping targets
# ---------------------------------------------------------------------------
def test_import_validation_and_mapping_targets(client: TestClient):
    """
    Importer validation:
    - empty computed label reports spreadsheet row number;
    - mapping to 'name' or '_name' works;
    - mapping two columns to same target fails;
    - invalid col reference in display_format fails.
    """
    res = client.post("/api/v1/groups", json={"name": "Import Errors Group"})
    gid = res.json()["group_id"]
    token = res.json()["admin_token"]

    # 1. Spreadsheet with an empty name row
    file_bytes = make_csv([
        ["Name", "Dept"],
        ["Alice", "CS"],
        ["   ", "EE"],  # Row 3 in spreadsheet has empty name
    ])

    imp_res = client.post(
        f"/api/v1/groups/{gid}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("sheet.csv", file_bytes, "text/csv")},
        data={
            "mapping": json.dumps({"0": "name", "1": "skip"}),
        },
    )
    assert imp_res.status_code == 422
    err_body = imp_res.json()["error"]
    assert "details" in err_body
    # Spreadsheet row number 3
    assert err_body["details"][0]["row"] == 3
    assert "Display name is empty" in err_body["details"][0]["message"]

    # 2. Mapping to '_name' directly also works
    file_good = make_csv([["Name"], ["Bob"]])
    imp_good = client.post(
        f"/api/v1/groups/{gid}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("good.csv", file_good, "text/csv")},
        data={"mapping": json.dumps({"0": "_name"})},
    )
    assert imp_good.status_code == 200
    assert imp_good.json()["rows_added"] == 1

    # 3. Two columns mapped to same target fails
    file_dup_cols = make_csv([["Col1", "Col2"], ["A", "B"]])
    imp_dup = client.post(
        f"/api/v1/groups/{gid}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("dup.csv", file_dup_cols, "text/csv")},
        data={"mapping": json.dumps({"0": "name", "1": "_name"})},
    )
    assert imp_dup.status_code == 422
    assert "Two columns may not map to the same target." in imp_dup.json()["error"]["message"]


# ---------------------------------------------------------------------------
# 6. Template and Exports headers
# ---------------------------------------------------------------------------
def test_template_and_export_headers(client: TestClient):
    """
    Template download: Name first with current name.
    Roster export: Display name first, then all fields, then Status, Active.
    Poll results CSV and Excel: Display name first.
    """
    res = client.post("/api/v1/groups", json={"name": "Export Headers Group"})
    gid = res.json()["group_id"]
    token = res.json()["admin_token"]

    # Rename built-in field to "Full Name"
    fields = client.get(f"/api/v1/groups/{gid}/fields", headers={"X-Admin-Token": token}).json()
    bf = next(f for f in fields if f["is_builtin"])
    client.patch(
        f"/api/v1/groups/{gid}/fields/{bf['id']}",
        headers={"X-Admin-Token": token},
        json={"name": "Full Name"},
    )

    # Create custom field "Branch"
    f_res = client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "Branch", "field_type": "text"},
    )
    branch_key = f_res.json()["key"]

    # 1. Template download CSV
    tmpl_res = client.get(f"/api/v1/groups/{gid}/members/template?format=csv", headers={"X-Admin-Token": token})
    assert tmpl_res.status_code == 200
    tmpl_csv = tmpl_res.content.decode("utf-8")
    assert tmpl_csv.strip() == "Full Name,Branch"

    # Add member
    client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={"members": [{"display_name": "Zara", "values": {"_name": "Zara", branch_key: "ECE"}}]},
    )

    # 2. Roster export CSV
    roster_res = client.get(f"/api/v1/groups/{gid}/members/export?format=csv", headers={"X-Admin-Token": token})
    assert roster_res.status_code == 200
    roster_csv = roster_res.content.decode("utf-8-sig")
    roster_header = roster_csv.splitlines()[0].split(",")
    assert roster_header == ["Display name", "Full Name", "Branch", "Status", "Active"]

    # 3. Poll results export CSV
    poll_res = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": token},
        json={
            "name": "Check Poll",
            "allow_multiple": False,
            "options": [{"label": "Done", "role": "target"}, {"label": "Pending", "role": "not_yet"}],
        },
    )
    pid = poll_res.json()["id"]

    results_res = client.get(f"/api/v1/polls/{pid}/results?format=csv", headers={"X-Admin-Token": token})
    assert results_res.status_code == 200
    results_csv = results_res.content.decode("utf-8-sig")
    results_header = results_csv.splitlines()[0].split(",")
    assert results_header[0] == "Display name"
