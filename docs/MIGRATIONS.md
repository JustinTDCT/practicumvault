# Database migrations

Practicum Vault uses Prisma Migrate for schema deployment.

**Never** mark `20250731140000_runtime_integrity` as applied unless its partial unique indexes have been positively verified (see `npm run maint -- --migration-status`).

## Inspect current database state

```bash
npm run maint -- --migration-status
```

This reports whether `_prisma_migrations` exists, which migrations are recorded, whether overhaul columns exist, whether both partial unique indexes exist, whether the login IP index exists, and the exact safe next command.

---

## 1. Empty database

```bash
npx prisma migrate deploy
```

Applies, in order:

1. `20240701000000_baseline` — original schema  
2. `20250731120000_simulation_security_overhaul` — snapshots, session version, login attempts, expanded attempt statuses  
3. `20250731140000_runtime_integrity` — partial unique indexes for active attempts/assignments  
4. Later migrations (turn IDs, rate buckets, etc.)

---

## 2. Original schema created with `prisma db push` (no migration history)

The database has the pre-overhaul tables but `_prisma_migrations` is empty or missing.

1. Run `npm run maint -- --migration-status` and confirm overhaul columns are **absent** and runtime indexes are **absent**.  
2. Baseline the original schema only:

```bash
npx prisma migrate resolve --applied 20240701000000_baseline
```

3. Apply remaining migrations for real (this creates overhaul columns and runtime indexes):

```bash
npx prisma migrate deploy
```

4. Re-run `npm run maint -- --migration-status` and confirm both partial unique indexes exist.

Do **not** mark the overhaul or runtime-integrity migrations as applied in this path — they must execute SQL.

---

## 3. Overhaul schema created with `prisma db push` (columns present, indexes may be missing)

The database already has overhaul columns (for example `scenario_snapshot`, `session_version`) because `db push` was used, but migration history may be empty and **partial unique indexes from runtime_integrity are often missing**.

1. Run `npm run maint -- --migration-status`.  
2. If overhaul columns exist and baseline/overhaul are not recorded:

```bash
npx prisma migrate resolve --applied 20240701000000_baseline
npx prisma migrate resolve --applied 20250731120000_simulation_security_overhaul
```

3. Deploy remaining migrations so runtime indexes and later changes are created:

```bash
npx prisma migrate deploy
```

4. Confirm with `--migration-status` that both partial unique indexes exist.

Do **not** mark `20250731140000_runtime_integrity` as applied unless status shows both indexes present. Marking it applied without indexes skips index creation entirely.

---

## 4. Database with the overhaul migration already recorded

History includes `20250731120000_simulation_security_overhaul` (and usually baseline). Runtime integrity may or may not be applied.

```bash
npm run maint -- --migration-status
npx prisma migrate deploy
```

If status shows runtime indexes missing while `20250731140000_runtime_integrity` is already recorded, do **not** re-mark it applied. Create the indexes manually from that migration’s SQL (or restore from backup and re-deploy), then verify with `--migration-status`.

---

## 5. Fully current database

`npm run maint -- --migration-status` reports all migrations recorded, overhaul columns present, both partial unique indexes present, and login IP index present. Next command: none (or only future `migrate deploy` after pulling new migrations).

---

## Legacy snapshot backfill

Attempts created before snapshots (or before `templateSlug`) may need backfill:

```bash
npm run maint -- --backfill-snapshots --dry-run
npm run maint -- --backfill-snapshots
```

After backfill, scoring and reports require a stored snapshot with `templateSlug`. Missing/invalid snapshots surface an administrative integrity error instead of using live template metadata.

## Production entrypoint

Docker production starts with:

```bash
prisma migrate deploy
```

Do not use `prisma db push` in production.
