# Project workflow

- Automatically push completed, verified game updates to the existing GitHub remote unless the user explicitly asks to hold that update. Never force-push or include unrelated changes.
- Coordinate database migrations with the matching client release. Keep named SQL visible in the Neon editor and verify the actual applied database state; saved SQL alone is not an applied migration.
- Preserve accounts, inventory, balances, and historical results unless the user specifically requests a reset.
