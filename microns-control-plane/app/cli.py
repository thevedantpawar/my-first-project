"""Small operator commands.

    python -m app.cli gen-key      # a MASTER_KEY to put in the environment
    python -m app.cli migrate      # bring the schema to head
    python -m app.cli make-staff <email>
"""

from __future__ import annotations

import sys

from cryptography.fernet import Fernet


def gen_key() -> int:
    """Print a fresh Fernet key.

    Printed rather than written anywhere: this value belongs in the deployment's
    environment and in a password manager, not in a file in the repo.
    """
    print(Fernet.generate_key().decode())
    return 0


def migrate() -> int:
    from alembic import command

    from app.database import _alembic_config

    command.upgrade(_alembic_config(), "head")
    print("Schema is at head.")
    return 0


def make_staff(email: str) -> int:
    """Grant an account operator access. Deliberately not self-serve."""
    from app.database import SessionLocal
    from app.services.accounts import find_user_by_email

    db = SessionLocal()
    try:
        user = find_user_by_email(db, email)
        if user is None:
            print(f"No user with address {email}", file=sys.stderr)
            return 1
        user.account.is_staff = True
        db.commit()
        print(f"{email} is now an operator on account {user.account.slug}.")
        return 0
    finally:
        db.close()


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    command_name, *rest = argv
    if command_name == "gen-key":
        return gen_key()
    if command_name == "migrate":
        return migrate()
    if command_name == "make-staff":
        if not rest:
            print("Usage: python -m app.cli make-staff <email>", file=sys.stderr)
            return 1
        return make_staff(rest[0])
    print(f"Unknown command: {command_name}\n{__doc__}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
