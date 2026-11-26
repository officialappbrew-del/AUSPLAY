import argparse

from sqlalchemy import select

from . import models
from .db import Base, SessionLocal, engine


def main() -> None:
    parser = argparse.ArgumentParser(description="Grant AusPlay administrator access.")
    parser.add_argument("username", help="Existing account to promote to administrator")
    args = parser.parse_args()

    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        user = db.scalar(
            select(models.User).where(models.User.username == args.username.lower())
        )
        if user is None:
            parser.error(f"No account exists for username {args.username!r}")
        user.role = "admin"
        db.commit()
        print(f"Administrator access granted to {user.username}.")


if __name__ == "__main__":
    main()
