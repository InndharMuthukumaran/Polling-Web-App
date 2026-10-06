"""API tests for member roster template, preview, and bulk import endpoints."""

import csv
import datetime
import io
import json
from unittest.mock import MagicMock
import zipfile
import openpyxl
import pytest

from tests.test_importer import make_csv, make_xlsx


def create_group_with_fields(client, name="Test Group"):
    """Helper to create a group and return (group_id, admin_token)."""
    res = client.post("/api/v1/groups", json={"name": name})
    assert res.status_code == 201
    data = res.json()
    return data["group_id"], data["admin_token"]


def add_field(client, group_id, token, name, field_type, is_identifier=False, **kwargs):
    """Helper to create a field and optionally mark it as identifier."""
    payload = {"name": name, "field_type": field_type, **kwargs}
    res = client.post(
        f"/api/v1/groups/{group_id}/fields",
        headers={"X-Admin-Token": token},
        json=payload,
    )
    assert res.status_code == 201
    f_data = res.json()
    if is_identifier:
        res_patch = client.patch(
            f"/api/v1/groups/{group_id}/fields/{f_data['id']}",
            headers={"X-Admin-Token": token},
            json={"is_identifier": True},
        )
        assert res_patch.status_code == 200
        f_data = res_patch.json()
    return f_data


def get_group_members(client, group_id, token):
    """Helper to get members of a group via GET /groups/{id}."""
    res = client.get(f"/api/v1/groups/{group_id}", headers={"X-Admin-Token": token})
    assert res.status_code == 200
    return res.json()["members"]


# ---------------------------------------------------------------------------
# 1. Template Endpoint Tests
# ---------------------------------------------------------------------------

def test_template_download_xlsx_and_csv(client):
    """Template returns Name first then fields in order; xlsx has dropdown validation."""
    group_id, token = create_group_with_fields(client)

    # Create fields in specific order
    add_field(client, group_id, token, "Register No", "text")
    add_field(client, group_id, token, "Dept", "choice", choices=["CSE", "ECE", "MECH"])

    # 1. XLSX template
    res_xlsx = client.get(
        f"/api/v1/groups/{group_id}/members/template?format=xlsx",
        headers={"X-Admin-Token": token},
    )
    assert res_xlsx.status_code == 200
    assert "spreadsheetml.sheet" in res_xlsx.headers["content-type"]
    assert 'filename="members-template.xlsx"' in res_xlsx.headers["content-disposition"]

    wb = openpyxl.load_workbook(io.BytesIO(res_xlsx.content))
    ws = wb.active
    header_vals = [cell.value for cell in ws[1]]
    assert header_vals == ["Name", "Register No", "Dept"]
    assert len(ws.data_validations.dataValidation) == 1
    dv = ws.data_validations.dataValidation[0]
    assert dv.type == "list"
    assert '"CSE,ECE,MECH"' in dv.formula1
    assert "C2:C2001" in str(dv.sqref)

    # 2. CSV template
    res_csv = client.get(
        f"/api/v1/groups/{group_id}/members/template?format=csv",
        headers={"X-Admin-Token": token},
    )
    assert res_csv.status_code == 200
    assert "text/csv" in res_csv.headers["content-type"]
    assert 'filename="members-template.csv"' in res_csv.headers["content-disposition"]
    assert res_csv.text.strip() == "Name,Register No,Dept"


# ---------------------------------------------------------------------------
# 2. Preview Endpoint Tests
# ---------------------------------------------------------------------------

def test_preview_endpoint_parity_and_mapping(client):
    """Preview returns columns, sample_rows, total_rows, and suggested_mapping; saves nothing."""
    group_id, token = create_group_with_fields(client)

    # Add Department field
    f_dept = add_field(client, group_id, token, "Department", "text")
    dept_key = f_dept["key"]

    rows = [
        ["Full Name", "Department", "Extra Info"],
        ["Alice", "CSE", "Active"],
        ["Bob", "ECE", "On Leave"],
    ]
    xlsx_bytes = make_xlsx(rows)
    csv_bytes = make_csv(rows)

    # Preview XLSX
    res_px = client.post(
        f"/api/v1/groups/{group_id}/members/import/preview",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res_px.status_code == 200
    data_px = res_px.json()
    assert data_px["total_rows"] == 2
    assert data_px["columns"] == [
        {"index": 0, "header": "Full Name"},
        {"index": 1, "header": "Department"},
        {"index": 2, "header": "Extra Info"},
    ]
    assert data_px["sample_rows"] == [["Alice", "CSE", "Active"], ["Bob", "ECE", "On Leave"]]
    assert data_px["suggested_mapping"] == {"0": "name", "1": dept_key, "2": "skip"}

    # Preview CSV gives same result
    res_pc = client.post(
        f"/api/v1/groups/{group_id}/members/import/preview",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.csv", csv_bytes, "text/csv")},
    )
    assert res_pc.status_code == 200
    data_pc = res_pc.json()
    assert data_pc["columns"] == data_px["columns"]
    assert data_pc["sample_rows"] == data_px["sample_rows"]
    assert data_pc["suggested_mapping"] == data_px["suggested_mapping"]

    # Check that nothing was saved
    assert len(get_group_members(client, group_id, token)) == 0


# ---------------------------------------------------------------------------
# 3. File Limits and Type Validation
# ---------------------------------------------------------------------------

def test_file_limits_and_types_rejected(client):
    """File type and size limits are rejected with 422 naming the limit."""
    group_id, token = create_group_with_fields(client)

    # 1. Unsupported extension
    res = client.post(
        f"/api/v1/groups/{group_id}/members/import/preview",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.txt", b"Name\nAlice", "text/plain")},
    )
    assert res.status_code == 422
    assert "Unsupported file type" in res.json()["error"]["message"]

    # 2. .xls and .xlsm
    for bad_name in ["roster.xls", "roster.xlsm"]:
        res = client.post(
            f"/api/v1/groups/{group_id}/members/import/preview",
            headers={"X-Admin-Token": token},
            files={"file": (bad_name, b"PKdummy", "application/octet-stream")},
        )
        assert res.status_code == 422
        assert "Please save the file as .xlsx or .csv." in res.json()["error"]["message"]

    # 3. Fake xlsx (not starting with PK)
    res = client.post(
        f"/api/v1/groups/{group_id}/members/import/preview",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.xlsx", b"NOT_A_ZIP", "application/octet-stream")},
    )
    assert res.status_code == 422
    assert "Invalid file content" in res.json()["error"]["message"]

    # 4. Exceeds 5 MB
    res = client.post(
        f"/api/v1/groups/{group_id}/members/import/preview",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.csv", b"x" * (5 * 1024 * 1024 + 1), "text/csv")},
    )
    assert res.status_code == 422
    assert "5 MB" in res.json()["error"]["message"]

    # 5. Zip uncompressed size > 50 MB
    mock_info = MagicMock()
    mock_info.file_size = 51 * 1024 * 1024
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(zipfile.ZipFile, "infolist", lambda self: [mock_info])
        bio = io.BytesIO()
        with zipfile.ZipFile(bio, "w") as zf:
            zf.writestr("test.xml", b"x")
        res = client.post(
            f"/api/v1/groups/{group_id}/members/import/preview",
            headers={"X-Admin-Token": token},
            files={"file": ("roster.xlsx", bio.getvalue(), "application/octet-stream")},
        )
        assert res.status_code == 422
        assert "50 MB" in res.json()["error"]["message"]


# ---------------------------------------------------------------------------
# 4 & 5. Cell Conversion and Import Happy Path
# ---------------------------------------------------------------------------

def test_import_happy_path_and_conversions(client):
    """Roster with Name, Reg No (numeric cell), Dept (choice), CGPA (number with float) imports accurately."""
    group_id, token = create_group_with_fields(client)

    # 1. Reg No (identifier, text)
    f_reg = add_field(client, group_id, token, "Register No", "text", is_identifier=True)
    reg_key = f_reg["key"]

    # 2. Dept (choice, with default)
    f_dept = add_field(
        client,
        group_id,
        token,
        "Dept",
        "choice",
        choices=["CSE", "ECE", "MECH"],
        default_value="CSE",
    )
    dept_key = f_dept["key"]

    # 3. CGPA (number)
    f_cgpa = add_field(client, group_id, token, "CGPA", "number")
    cgpa_key = f_cgpa["key"]

    # Data includes numeric register number 21001.0, blank Dept (to get default), float CGPA, duplicate display name
    rows = [
        ["Name", "Register No", "Dept", "CGPA"],
        ["Alice Smith", 21001.0, "", 9.5],             # Dept blank -> CSE default, float 21001.0 -> "21001"
        ["Alice Smith", 21002, "ECE", 8.0],            # Duplicate display name allowed because identifier exists!
        ["Bob Jones", "21003", "mech", 7.2],           # Choice case-insensitive canonicalization
    ]
    xlsx_bytes = make_xlsx(rows)

    mapping = {
        "0": "name",
        "1": reg_key,
        "2": dept_key,
        "3": cgpa_key,
    }

    res_imp = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"mapping": json.dumps(mapping)},
    )
    assert res_imp.status_code == 200
    res_data = res_imp.json()
    assert res_data["dry_run"] is False
    assert res_data["rows_total"] == 3
    assert res_data["rows_added"] == 3
    assert res_data["rows_skipped"] == 0

    # Verify members in database
    members = get_group_members(client, group_id, token)
    assert len(members) == 3

    m_by_id = {m["identifier"]: m for m in members}
    assert "21001" in m_by_id
    assert "21002" in m_by_id
    assert "21003" in m_by_id

    # Check values
    assert m_by_id["21001"]["values"][dept_key] == "CSE"  # default filled
    assert m_by_id["21001"]["values"][cgpa_key] == 9.5
    assert m_by_id["21002"]["values"][cgpa_key] == 8  # whole number float -> int for number field
    assert m_by_id["21003"]["values"][dept_key] == "MECH"  # canonical choice


# ---------------------------------------------------------------------------
# 6. All or Nothing & Error Limits
# ---------------------------------------------------------------------------

def test_import_all_or_nothing_and_error_reporting(client):
    """A single bad row rolls back everything and reports spreadsheet row numbers."""
    group_id, token = create_group_with_fields(client)

    f_score = add_field(client, group_id, token, "Score", "number", is_required=True)
    score_key = f_score["key"]

    rows = [
        ["", ""],                # Row 1 (blank)
        ["Name", "Score"],       # Row 2 (Headers)
        ["Alice", 95],           # Row 3 (Valid)
        ["Bob", "not-a-number"], # Row 4 (Invalid number on Score)
        ["Charlie", 88],         # Row 5 (Valid)
    ]
    xlsx_bytes = make_xlsx(rows)
    mapping = {"0": "name", "1": score_key}

    res_imp = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.xlsx", xlsx_bytes, "application/octet-stream")},
        data={"mapping": json.dumps(mapping)},
    )
    assert res_imp.status_code == 422
    err_resp = res_imp.json()["error"]
    assert "details" in err_resp
    assert len(err_resp["details"]) == 1
    # Check spreadsheet row number
    assert err_resp["details"][0]["row"] == 4
    assert err_resp["details"][0]["field"] == "Score"

    # Verify nothing was saved
    assert len(get_group_members(client, group_id, token)) == 0


def test_import_max_100_errors_reported_with_total_count(client):
    """More than 100 errors lists at most 100 in details, but reports total count in message."""
    group_id, token = create_group_with_fields(client)

    f_score = add_field(client, group_id, token, "Score", "number", is_required=True)
    score_key = f_score["key"]

    # 105 invalid rows
    rows = [["Name", "Score"]] + [[f"Member {i}", "bad_num"] for i in range(105)]
    csv_bytes = make_csv(rows)
    mapping = {"0": "name", "1": score_key}

    res_imp = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.csv", csv_bytes, "text/csv")},
        data={"mapping": json.dumps(mapping)},
    )
    assert res_imp.status_code == 422
    err_resp = res_imp.json()["error"]
    assert "105 errors" in err_resp["message"]
    assert len(err_resp["details"]) == 100


# ---------------------------------------------------------------------------
# 7. Duplicates (In-File and Existing)
# ---------------------------------------------------------------------------

def test_import_duplicates_in_file(client):
    """Duplicate identifier inside the file errors on later row naming earlier row."""
    group_id, token = create_group_with_fields(client)

    f_reg = add_field(client, group_id, token, "Register No", "text", is_identifier=True)
    reg_key = f_reg["key"]

    rows = [
        ["Name", "Register No"],
        ["Alice", "21001"],     # Row 2
        ["Bob", "21002"],       # Row 3
        ["Charlie", "21001"],   # Row 4 (Duplicate of row 2)
    ]
    csv_bytes = make_csv(rows)
    mapping = {"0": "name", "1": reg_key}

    res_imp = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.csv", csv_bytes, "text/csv")},
        data={"mapping": json.dumps(mapping)},
    )
    assert res_imp.status_code == 422
    err_resp = res_imp.json()["error"]
    detail = err_resp["details"][0]
    assert detail["row"] == 4
    assert detail["field"] == "Register No"
    assert "row 2" in detail["message"]


def test_import_duplicates_against_existing_reject_and_skip(client):
    """Existing member duplicate with reject fails; with skip it skips and adds remaining."""
    group_id, token = create_group_with_fields(client)

    f_reg = add_field(client, group_id, token, "Register No", "text", is_identifier=True)
    reg_key = f_reg["key"]

    # Pre-add Alice with 21001
    res_m = client.post(
        f"/api/v1/groups/{group_id}/members",
        headers={"X-Admin-Token": token},
        json={"members": [{"display_name": "Alice Original", "values": {reg_key: "21001"}}]},
    )
    assert res_m.status_code == 201

    rows = [
        ["Name", "Register No"],
        ["Alice Duplicate", "21001"],
        ["Bob New", "21002"],
    ]
    csv_bytes = make_csv(rows)
    mapping = {"0": "name", "1": reg_key}

    # 1. on_duplicate=reject (default) -> fails with 422
    res_rej = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.csv", csv_bytes, "text/csv")},
        data={"mapping": json.dumps(mapping), "on_duplicate": "reject"},
    )
    assert res_rej.status_code == 422
    assert "already exists in group" in res_rej.json()["error"]["message"]

    # 2. on_duplicate=skip -> skips Alice, adds Bob
    res_skip = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.csv", csv_bytes, "text/csv")},
        data={"mapping": json.dumps(mapping), "on_duplicate": "skip"},
    )
    assert res_skip.status_code == 200
    skip_data = res_skip.json()
    assert skip_data["rows_total"] == 2
    assert skip_data["rows_added"] == 1
    assert skip_data["rows_skipped"] == 1

    # Check Alice Original was not changed
    members = get_group_members(client, group_id, token)
    assert len(members) == 2
    m_alice = next(m for m in members if m["identifier"] == "21001")
    assert m_alice["display_name"] == "Alice Original"


# ---------------------------------------------------------------------------
# 8. Dry Run Tests
# ---------------------------------------------------------------------------

def test_import_dry_run(client):
    """dry_run=true returns identical counts as real run and saves nothing."""
    group_id, token = create_group_with_fields(client)

    rows = [
        ["Name"],
        ["Alice"],
        ["Bob"],
    ]
    csv_bytes = make_csv(rows)
    mapping = {"0": "name"}

    res_dry = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.csv", csv_bytes, "text/csv")},
        data={"mapping": json.dumps(mapping), "dry_run": "true"},
    )
    assert res_dry.status_code == 200
    dry_data = res_dry.json()
    assert dry_data["dry_run"] is True
    assert dry_data["rows_total"] == 2
    assert dry_data["rows_added"] == 2
    assert dry_data["rows_skipped"] == 0

    # Ensure database is untouched
    assert len(get_group_members(client, group_id, token)) == 0


# ---------------------------------------------------------------------------
# 9. New Fields From Sheet
# ---------------------------------------------------------------------------

def test_import_new_fields_creation(client):
    """Creates text and choice fields from unmapped columns in same transaction."""
    group_id, token = create_group_with_fields(client)

    rows = [
        ["Full Name", "Register No", "Branch"],
        ["Alice", "21001", "CSE"],
        ["Bob", "21002", "ECE"],
    ]
    xlsx_bytes = make_xlsx(rows)
    # Column 0 mapped to name, columns 1 and 2 unmapped
    mapping = {"0": "name"}
    new_fields = [
        {
            "column": 1,
            "name": "Register No",
            "field_type": "text",
            "is_identifier": True,
        },
        {
            "column": "Branch",
            "name": "Department",
            "field_type": "choice",
            "choices": ["CSE", "ECE", "MECH"],
        },
    ]

    res_imp = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.xlsx", xlsx_bytes, "application/octet-stream")},
        data={"mapping": json.dumps(mapping), "new_fields": json.dumps(new_fields)},
    )
    assert res_imp.status_code == 200
    data = res_imp.json()
    assert data["rows_added"] == 2
    assert "Register No" in data["fields_created"]
    assert "Department" in data["fields_created"]

    # Check fields and members exist
    res_f = client.get(f"/api/v1/groups/{group_id}/fields", headers={"X-Admin-Token": token})
    f_list = res_f.json()
    assert len(f_list) == 2
    reg_field = next(f for f in f_list if f["name"] == "Register No")
    assert reg_field["is_identifier"] is True

    members = get_group_members(client, group_id, token)
    assert len(members) == 2


def test_import_new_fields_identifier_on_group_with_members_fails(client):
    """Creating an identifier field on a group with members fails with R1a message and saves nothing."""
    group_id, token = create_group_with_fields(client)

    # Pre-add a member
    res_m = client.post(
        f"/api/v1/groups/{group_id}/members",
        headers={"X-Admin-Token": token},
        json={"display_names": ["Existing Member"]},
    )
    assert res_m.status_code == 201

    rows = [
        ["Name", "Reg No"],
        ["Alice", "21001"],
    ]
    csv_bytes = make_csv(rows)
    mapping = {"0": "name"}
    new_fields = [
        {
            "column": 1,
            "name": "Reg No",
            "field_type": "text",
            "is_identifier": True,
        }
    ]

    res_imp = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.csv", csv_bytes, "text/csv")},
        data={"mapping": json.dumps(mapping), "new_fields": json.dumps(new_fields)},
    )
    assert res_imp.status_code == 422
    assert "Cannot create a new field as the identifier while members exist" in res_imp.json()["error"]["message"]

    # Verify no new field was created
    res_f = client.get(f"/api/v1/groups/{group_id}/fields", headers={"X-Admin-Token": token})
    assert len(res_f.json()) == 0


# ---------------------------------------------------------------------------
# 10. Mapping Validation
# ---------------------------------------------------------------------------

def test_mapping_validation_errors(client):
    """Missing name, multiple mapped to same target, unknown key, and duplicate mapping with new_fields are 422."""
    group_id, token = create_group_with_fields(client)

    f_dept = add_field(client, group_id, token, "Dept", "text")
    dept_key = f_dept["key"]

    rows = [
        ["ColA", "ColB", "ColC"],
        ["Alice", "CSE", "CSE"],
    ]
    csv_bytes = make_csv(rows)

    # 1. No name column
    res1 = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.csv", csv_bytes, "text/csv")},
        data={"mapping": json.dumps({"0": dept_key, "1": "skip"})},
    )
    assert res1.status_code == 422
    assert "Exactly one column must be mapped to 'name'" in res1.json()["error"]["message"]

    # 2. Two columns mapped to same target
    res2 = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.csv", csv_bytes, "text/csv")},
        data={"mapping": json.dumps({"0": "name", "1": dept_key, "2": dept_key})},
    )
    assert res2.status_code == 422
    assert "Two columns may not map to the same target" in res2.json()["error"]["message"]

    # 3. Unknown field key
    res3 = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.csv", csv_bytes, "text/csv")},
        data={"mapping": json.dumps({"0": "name", "1": "nonexistent_key"})},
    )
    assert res3.status_code == 422
    assert "Unknown field key" in res3.json()["error"]["message"]

    # 4. new_fields pointing at column that is also mapped
    res4 = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("roster.csv", csv_bytes, "text/csv")},
        data={
            "mapping": json.dumps({"0": "name", "1": dept_key}),
            "new_fields": json.dumps([{"column": 1, "name": "NewField"}]),
        },
    )
    assert res4.status_code == 422
    assert "already mapped" in res4.json()["error"]["message"]


# ---------------------------------------------------------------------------
# 11. Auth Guards
# ---------------------------------------------------------------------------

def test_import_auth_guards(client):
    """Endpoints require valid X-Admin-Token for that group."""
    group_a, token_a = create_group_with_fields(client, "Group A")
    group_b, token_b = create_group_with_fields(client, "Group B")

    csv_bytes = make_csv([["Name"], ["Alice"]])

    for url, method, extra in [
        (f"/api/v1/groups/{group_a}/members/template", "get", {}),
        (f"/api/v1/groups/{group_a}/members/import/preview", "post", {"files": {"file": ("r.csv", csv_bytes, "text/csv")}}),
        (f"/api/v1/groups/{group_a}/members/import", "post", {"files": {"file": ("r.csv", csv_bytes, "text/csv")}, "data": {"mapping": '{"0":"name"}'}}),
    ]:
        # Missing token -> 401
        if method == "get":
            r1 = client.get(url)
        else:
            r1 = client.post(url, **extra)
        assert r1.status_code == 401
        assert r1.json()["error"]["code"] == "missing_token"

        # Another group's token -> 403
        headers_b = {"X-Admin-Token": token_b}
        if method == "get":
            r2 = client.get(url, headers=headers_b)
        else:
            r2 = client.post(url, headers=headers_b, **extra)
        assert r2.status_code == 403
        assert r2.json()["error"]["code"] == "forbidden"
