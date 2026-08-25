"""Service layer: encryption, audit, de-identification, LLM, SMS, booking.

Routers stay thin — they validate input and delegate here. Everything that
touches PHI lives in this package so the audit and encryption rules have one
place to be enforced.
"""
