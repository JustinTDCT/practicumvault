# Practicum Vault

AI-driven, template-based skill assessment system for technical hiring and internal evaluation.

## Features

- **Template-driven scenarios** — All scenario content lives in the database with a mandatory schema (metadata, starting situation, hidden environment, actions, gates, rubric, hints). Nothing is hardcoded.
- **Gated simulations** — Candidates interact in natural language; the AI returns only evidence defined by the template.
- **Hybrid scoring** — Deterministic rubric structure with AI evaluation of gates and final report.
- **Server-side timing** — Global scenario timer with configurable countdown/elapsed display.
- **Admin console** — Users, positions, templates, assignments, live sessions with transcript, PDF reports.
- **Multi-provider LLM** — Anthropic, OpenAI, or local OpenAI-compatible (Ollama).
- **Session isolation** — One active attempt per candidate; abort/timeout = score 0, must restart.

## Quick start (Docker)

```bash
cp .env.example .env
# Edit SESSION_SECRET and ENCRYPTION_KEY in .env

docker compose up --build
```

Open http://localhost:3000 — complete the setup wizard to create your org and primary admin.

### With Ollama (optional)

```bash
docker compose --profile ollama up --build
```

Configure in Admin → Settings: provider **Local**, base URL `http://ollama:11434/v1`, model e.g. `llama3.2`.

## Local development

Requirements: Node 22+, PostgreSQL 16+

```bash
cp .env.example .env
npm install
npx prisma db push
npm run dev
```

## Maintenance CLI

Reset an admin or candidate password:

```bash
npm run maint -- --password --admin@example.com
# or
NEW_PASSWORD='newpassword123' npm run maint -- --password admin@example.com
```

## Workflow

1. **Setup wizard** — Create org + primary admin
2. **Settings** — Configure LLM provider and timer display
3. **Positions** — Create role labels (Tier 1, Tier 2, etc.)
4. **Templates** — Create scenario, edit all sections in admin UI, publish
5. **Users** — Create candidate accounts
6. **Assignments** — Assign latest published version to candidates
7. **Candidate** — Starts scenario, chat-based simulation, submits when done
8. **Reports** — Admin views score, transcript, downloads PDF for employee file

## Template schema

Every scenario version includes:

| Section | Purpose |
|---------|---------|
| metadata | Title, skill level, environment |
| startingSituation | Ticket and candidate instructions |
| environment | Hidden root cause and facts |
| actions | Predefined diagnostic results |
| gates | Pass criteria (typically 4 gates) |
| scoringRubric | Weighted categories (must sum to 100) |
| hints | Ladder with score penalties |
| completionConditions | When scenario is complete |

Published versions are immutable once attempts exist. Edits create a new draft version.

## Architecture

- **Next.js 15** (App Router) — UI + API
- **PostgreSQL + Prisma** — System of record
- **Vercel AI SDK** — Streaming chat + structured scoring
- **@react-pdf/renderer** — PDF reports
- **iron-session** — Auth sessions
- **Docker Compose** — Production-like local deployment

The AI runs the interview; the application owns identity, timing, storage, scoring audit trail, and reporting.

## Design principles

From the reference transcript model:

- Reveal complete evidence when the candidate requests a specific investigation
- Do not pass gates on keyword guesses — require evidence
- Allow plausible wrong paths without failing the candidate
- Separate immediate remediation from permanent fix
- Unsafe actions carry explicit penalties

## Next steps

Build your first real scenario via Admin → Templates after configuring your LLM provider. A minimal smoke-test template is created automatically when you add a new template — customize it before publishing.
