# Database migrations

Practicum Vault uses Prisma Migrate for schema deployment.

## Fresh (empty) database

```bash
npx prisma migrate deploy
```

This applies, in order:

1. `20240701000000_baseline` — original schema
2. `20250731120000_simulation_security_overhaul` — snapshots, session version, login attempts, expanded attempt statuses
3. `20250731140000_runtime_integrity` — partial unique indexes for active attempts/assignments

## Existing database created with `prisma db push`

If the database already matches the current schema but has no migration history:

```bash
npx prisma migrate resolve --applied 20240701000000_baseline
npx prisma migrate resolve --applied 20250731120000_simulation_security_overhaul
npx prisma migrate resolve --applied 20250731140000_runtime_integrity
```

Then future migrations can use `npx prisma migrate deploy` normally.

## Existing database that already applied only the overhaul migration

```bash
npx prisma migrate resolve --applied 20240701000000_baseline
npx prisma migrate deploy
```

## Legacy snapshot backfill

Attempts created before snapshots were introduced may have `scenario_snapshot = NULL`.

```bash
npm run maint -- --backfill-snapshots --dry-run
npm run maint -- --backfill-snapshots
```

After backfill, scoring and reports require a stored snapshot.

## Production entrypoint

Docker production starts with:

```bash
prisma migrate deploy
```

Do not use `prisma db push` in production.
