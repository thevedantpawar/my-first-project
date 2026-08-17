-- Runs once, on first initialisation of the postgres data volume.
--
-- pgcrypto gives us gen_random_uuid() plus digest()/hmac() for the
-- deterministic lookup fingerprints described in docs. Application-level PHI
-- encryption is done with Fernet (AES-128-CBC + HMAC-SHA256) in
-- app/services/encryption.py so that ciphertext is opaque to the database and
-- to anyone with a raw dump.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
