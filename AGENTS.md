# Project workflow

- Automatically push completed, verified game updates to the existing GitHub remote unless the user explicitly asks to hold that update. Never force-push or include unrelated changes.
- Coordinate database migrations with the matching client release. Apply migrations directly to Neon and verify the actual applied database state. Keep SQL sources in Git; do not recreate Saved SQL Editor copies unless the user asks. Saved queries and History are editor records, not the running database.
- Preserve accounts, inventory, balances, and historical results unless the user specifically requests a reset.
