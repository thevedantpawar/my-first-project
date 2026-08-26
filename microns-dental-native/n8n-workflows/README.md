# n8n workflows — native-app implementation

These six JSON files are a **complete, self-contained** implementation of the
six modules, importable directly into n8n. They talk to Google
Calendar/Contacts/Gmail/Drive, Twilio, Calendly and Google Business Profile
**directly** — no dependency on the `backend/` FastAPI service in this repo.
State that would otherwise need a database lives in n8n **Data Tables**
instead of long `Wait` node chains (n8n's own guidance recommends this once a
delay runs past about a week).

| File | Module | Data Table |
|---|---|---|
| `hygiene_recall_google_calendar.json` | 1 — Hygiene recall | `dental_recalls` |
| `treatment_plan_followup_gmail.json` | 2 — Treatment plan follow-up | `treatment_plan_followups` |
| `review_request_google_calendar.json` | 3 — Review request & response | `review_requests` |
| `emergency_capture_twilio.json` | 4 — After-hours emergency capture | `emergency_calls` |
| `lead_qualification_chat.json` | 5 — Lead qualification | `leads_nurture` |
| `insurance_verification_gmail.json` | 6 — Insurance verification | `insurance_verifications` |

## Importing

1. In n8n: **Workflows → Import from File**, select each JSON in turn.
2. Create the four Data Tables above (n8n → Data Tables → New) with the
   columns each workflow's nodes reference (visible in each node's *Columns*
   parameter after import) — or run them once and let n8n prompt you.
3. Every `<__PLACEHOLDER_VALUE__...__>` string is a value you must fill in
   before activating: Google Calendar IDs, the Google Business Profile
   account/location, a Twilio phone number, and the approval-draft email
   addresses. Search each workflow for `PLACEHOLDER` to find them all.
4. Connect credentials: Google Calendar, Google Contacts, Gmail, Google
   Business Profile, Twilio, and an OpenAI (or other) credential for the
   `@n8n/n8n-nodes-langchain` nodes.
5. Activate each workflow.

## Relationship to `backend/`

This repo also ships a FastAPI backend (`../backend/`) implementing the same
six modules against PostgreSQL, with field-level PHI encryption, an
immutable HIPAA audit trail, and a VAPI voice agent. The two are
**independent, not layered** — pick one, or run both against different
practices. The backend is the better fit if you want persistent, queryable,
audited state and a REST API a real EHR/PMS can call into; these n8n
workflows are the better fit if you want something you can see, edit and
extend visually with no code deploy.

## A pre-flight validation quirk worth knowing

n8n validates every Resource-Locator field in a workflow (Calendar IDs, GBP
account/location) **before running any node**, even ones outside the branch
you're triggering. Until every placeholder above is filled in, every trigger
in a given workflow will fail immediately with a "Not a valid ... ID"
error — that's expected, not a bug, and it clears the moment the IDs are set.
