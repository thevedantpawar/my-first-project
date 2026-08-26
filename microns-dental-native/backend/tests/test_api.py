def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "warnings" in body


def test_root(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "modules" in response.json()


def test_internal_endpoints_require_token(client):
    response = client.post("/internal/recalls/process-due")
    assert response.status_code == 401


def test_internal_endpoints_accept_token(client, internal_headers):
    response = client.post("/internal/recalls/process-due", headers=internal_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_staff_endpoints_require_token(client):
    response = client.get("/retention/dashboard")
    assert response.status_code == 401


def test_lead_chat_greeting_and_first_answer(client):
    greeting = client.post("/leads/chat", json={"message": "__init__", "source": "website_chat"})
    assert greeting.status_code == 200
    body = greeting.json()
    assert body["asking"] == "treatment_interest"
    session_id = body["session_id"]

    reply = client.post("/leads/chat", json={"message": "Cleaning", "session_id": session_id})
    assert reply.status_code == 200
    assert reply.json()["asking"] == "last_visit"


def test_lead_qualify_direct_submission(client):
    response = client.post(
        "/leads/qualify",
        json={
            "treatment_interest": "whitening", "last_visit": "2_plus_years", "insurance_type": "none",
            "pain_level": "none", "timeline": "browsing", "phone": "+15551112222", "name": "Sam Test",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["tier"] == "cold"
    assert body["status"] == "nurture"
