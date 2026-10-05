"""API tests for group custom fields, member values, and row-level details."""

import uuid
import pytest


def test_field_endpoints_crud_and_auth(client):
    """
    Field endpoints:
    - GET, POST, PATCH, DELETE /api/v1/groups/{group_id}/fields;
    - Auth guards: no token 401, wrong token 401, wrong group token 403;
    - Ordered position;
    - Position, keys, types preserved.
    """
    # Create Group A
    res_a = client.post("/api/v1/groups", json={"name": "Group A"})
    assert res_a.status_code == 201
    group_a_id = res_a.json()["group_id"]
    token_a = res_a.json()["admin_token"]

    # Create Group B
    res_b = client.post("/api/v1/groups", json={"name": "Group B"})
    assert res_b.status_code == 201
    group_b_id = res_b.json()["group_id"]
    token_b = res_b.json()["admin_token"]

    # 1. GET /fields auth checks
    res = client.get(f"/api/v1/groups/{group_a_id}/fields")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "missing_token"

    res = client.get(
        f"/api/v1/groups/{group_a_id}/fields",
        headers={"X-Admin-Token": token_b},
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"

    res = client.get(
        f"/api/v1/groups/{group_a_id}/fields",
        headers={"X-Admin-Token": token_a},
    )
    assert res.status_code == 200
    assert res.json() == []

    # 2. POST /fields
    res = client.post(
        f"/api/v1/groups/{group_a_id}/fields",
        headers={"X-Admin-Token": token_b},
        json={"name": "Reg No", "field_type": "text"},
    )
    assert res.status_code == 403

    # Create field 1 (text)
    res = client.post(
        f"/api/v1/groups/{group_a_id}/fields",
        headers={"X-Admin-Token": token_a},
        json={"name": "Register No", "field_type": "text", "is_required": False},
    )
    assert res.status_code == 201
    f1 = res.json()
    assert f1["key"] == "register_no"
    assert f1["name"] == "Register No"
    assert f1["field_type"] == "text"
    assert f1["is_required"] is False
    assert f1["is_identifier"] is False
    assert f1["position"] == 1
    f1_id = f1["id"]

    # Create field 2 (choice)
    res = client.post(
        f"/api/v1/groups/{group_a_id}/fields",
        headers={"X-Admin-Token": token_a},
        json={
            "name": "Branch",
            "field_type": "choice",
            "choices": ["CSE", "ECE", "MECH"],
            "default_value": "CSE",
        },
    )
    assert res.status_code == 201
    f2 = res.json()
    assert f2["key"] == "branch"
    assert f2["choices"] == ["CSE", "ECE", "MECH"]
    assert f2["default_value"] == "CSE"
    assert f2["position"] == 2
    f2_id = f2["id"]

    # 3. GET /fields ordered by position
    res = client.get(
        f"/api/v1/groups/{group_a_id}/fields",
        headers={"X-Admin-Token": token_a},
    )
    assert res.status_code == 200
    fields_list = res.json()
    assert len(fields_list) == 2
    assert fields_list[0]["position"] == 1
    assert fields_list[1]["position"] == 2

    # 4. PATCH /fields/{id}
    res = client.patch(
        f"/api/v1/groups/{group_a_id}/fields/{f1_id}",
        headers={"X-Admin-Token": token_b},
        json={"name": "Registration Number"},
    )
    assert res.status_code == 403

    res = client.patch(
        f"/api/v1/groups/{group_a_id}/fields/{f1_id}",
        headers={"X-Admin-Token": token_a},
        json={"name": "Registration Number"},
    )
    assert res.status_code == 200
    patched_f1 = res.json()
    assert patched_f1["name"] == "Registration Number"
    # Key must NOT change on rename
    assert patched_f1["key"] == "register_no"

    # 5. DELETE /fields/{id}
    res = client.delete(
        f"/api/v1/groups/{group_a_id}/fields/{f2_id}",
        headers={"X-Admin-Token": token_b},
    )
    assert res.status_code == 403

    res = client.delete(
        f"/api/v1/groups/{group_a_id}/fields/{f2_id}",
        headers={"X-Admin-Token": token_a},
    )
    assert res.status_code == 204

    res = client.get(
        f"/api/v1/groups/{group_a_id}/fields",
        headers={"X-Admin-Token": token_a},
    )
    assert len(res.json()) == 1


def test_members_bulk_api_validation_and_row_details(client):
    """
    POST /groups/{id}/members:
    - accepts {display_names: [...]};
    - accepts {members: [{display_name, values?}]};
    - sending both or neither returns 422;
    - more than 2000 rows returns 422;
    - bad row returns 422 with row-level details (row, field, message).
    """
    res = client.post("/api/v1/groups", json={"name": "Members API Group"})
    gid = res.json()["group_id"]
    token = res.json()["admin_token"]

    # Add a number field and a link field
    client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "Age", "field_type": "number"},
    )
    client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "Website", "field_type": "link"},
    )

    # 1. Neither display_names nor members -> 422
    res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"

    # 2. Both display_names and members -> 422
    res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={
            "display_names": ["Alice"],
            "members": [{"display_name": "Bob"}],
        },
    )
    assert res.status_code == 422

    # 3. More than 2000 rows -> 422
    res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={"display_names": [f"Member {i}" for i in range(2001)]},
    )
    assert res.status_code == 422
    assert "2000" in res.json()["error"]["message"]

    # 4. Bad row in members returns 422 with row-level details
    res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={
            "members": [
                {"display_name": "Row 1 Good", "values": {"age": 25, "website": "https://good.com"}},
                {"display_name": "Row 2 Bad Link", "values": {"website": "not-a-valid-link"}},
                {"display_name": "Row 3 Bad Age", "values": {"age": "NaN"}},
            ]
        },
    )
    assert res.status_code == 422
    err = res.json()["error"]
    assert err["code"] == "validation_error"
    assert "details" in err
    details = err["details"]
    assert len(details) >= 2
    # Verify row numbers are 1-based and field names are present
    rows = [d["row"] for d in details]
    fields = [d["field"] for d in details]
    assert 2 in rows
    assert 3 in rows
    assert "Website" in fields
    assert "Age" in fields

    # Verify all-or-nothing: no members were inserted
    group_res = client.get(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": token},
    )
    assert group_res.json()["members"] == []

    # 5. Success with {members: [...]}
    res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={
            "members": [
                {"display_name": "Alice", "values": {"age": "30", "website": "https://alice.org"}},
                {"display_name": "Bob", "values": {"age": 40}},
            ]
        },
    )
    assert res.status_code == 201
    created_members = res.json()
    assert len(created_members) == 2
    assert created_members[0]["values"]["age"] == 30
    assert created_members[0]["values"]["website"] == "https://alice.org"
    assert created_members[1]["values"]["age"] == 40
    assert "website" not in created_members[1]["values"]

    # 6. Success with {display_names: [...]}
    res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={"display_names": ["Charlie", "Diana"]},
    )
    assert res.status_code == 201
    assert len(res.json()) == 2


def test_patch_member_values_api(client):
    """PATCH /groups/{id}/members/{member_id} partial values update."""
    res = client.post("/api/v1/groups", json={"name": "Patch Member API"})
    gid = res.json()["group_id"]
    token = res.json()["admin_token"]

    client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "Score", "field_type": "number", "default_value": "50"},
    )
    client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "Bio", "field_type": "text"},
    )

    mem_res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={"members": [{"display_name": "Alice", "values": {"bio": "Hello"}}]},
    )
    mid = mem_res.json()[0]["id"]

    # 1. Update score
    patch_res = client.patch(
        f"/api/v1/groups/{gid}/members/{mid}",
        headers={"X-Admin-Token": token},
        json={"values": {"score": 99}},
    )
    assert patch_res.status_code == 200
    data = patch_res.json()
    assert data["values"]["score"] == 99
    assert data["values"]["bio"] == "Hello"

    # 2. Reset score to default by sending blank
    reset_res = client.patch(
        f"/api/v1/groups/{gid}/members/{mid}",
        headers={"X-Admin-Token": token},
        json={"values": {"score": ""}},
    )
    assert reset_res.status_code == 200
    assert reset_res.json()["values"]["score"] == 50

    # 3. Unknown field key -> 422
    bad_key_res = client.patch(
        f"/api/v1/groups/{gid}/members/{mid}",
        headers={"X-Admin-Token": token},
        json={"values": {"unknown_field": "test"}},
    )
    assert bad_key_res.status_code == 422


def test_get_group_includes_fields_and_member_values_and_identifier(client):
    """
    GET /groups/{id}:
    - includes fields;
    - includes member values (object);
    - includes member identifier (original text or null).
    """
    res = client.post("/api/v1/groups", json={"name": "Full Detail Group"})
    gid = res.json()["group_id"]
    token = res.json()["admin_token"]

    # Create fields
    f_id_res = client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "ID Code", "field_type": "text"},
    )
    f_id_id = f_id_res.json()["id"]

    client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "City", "field_type": "text", "default_value": "New York"},
    )

    # Mark ID Code as identifier
    client.patch(
        f"/api/v1/groups/{gid}/fields/{f_id_id}",
        headers={"X-Admin-Token": token},
        json={"is_identifier": True},
    )

    # Add two members with identical display_name (allowed once identifier exists)
    client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={
            "members": [
                {"display_name": "Sam", "values": {"id_code": "SAM-001"}},
                {"display_name": "Sam", "values": {"id_code": "SAM-002", "city": "London"}},
            ]
        },
    )

    # GET /groups/{id}
    res = client.get(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": token},
    )
    assert res.status_code == 200
    body = res.json()

    # Check fields
    assert "fields" in body
    assert len(body["fields"]) == 2
    assert body["fields"][0]["key"] == "id_code"
    assert body["fields"][0]["is_identifier"] is True
    assert body["fields"][1]["key"] == "city"

    # Check members
    assert len(body["members"]) == 2
    m1 = body["members"][0]
    m2 = body["members"][1]

    assert m1["identifier"] == "SAM-001"
    assert m1["values"]["id_code"] == "SAM-001"
    assert m1["values"]["city"] == "New York"

    assert m2["identifier"] == "SAM-002"
    assert m2["values"]["id_code"] == "SAM-002"
    assert m2["values"]["city"] == "London"
