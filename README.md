# Atlas

> Dynatrace App for tenant observability assessment, platform review, and exportable evidence.

Atlas is a native Dynatrace AppEngine application that inspects a Dynatrace environment and turns live platform data into actionable assessment results. It combines DQL-based signal checks, platform API inventory, snapshot history, and PDF/HTML exports so teams can understand observability coverage, utilization, and migration posture without changing tenant data.

> Historical note: several source files and docs still use the earlier **Pulse Assessment** name for the 9-capability assessment module. In this repository, **Atlas** is the current project name.

## Overview

Atlas currently exposes three complementary experiences:

- **Pulse Assessment** — evaluates 9 observability capabilities across **111 criteria** using live Grail queries, then scores **Coverage** and **Utilization**.
- **Tenant Review** — provides structured review areas for inventory, Gen3 adoption, utilization, settings, security, extensions, dashboards, synthetic, logs, and related platform areas.
- **Observability Evaluation** — runs a deeper probe-based review across **10 domains / ~46 probes** and generates findings plus roadmap-style output.

The repository also includes:

- a **scheduled workflow example** for server-side assessments (`docs/workflow-scheduled-assessment.yaml`)
- a **standalone CLI fallback** for collecting evidence outside the app (`tools/tenant-evaluator/README.md`)
- a **dashboard artifact** for Dynatrace Document Store deployment (`dashboards/finops-cloud-management.json`)

## Capabilities

### Pulse Assessment capability model

| Capability | Criteria |
| --- | ---: |
| Infrastructure Observability | 22 |
| Application Observability | 13 |
| Digital Experience | 11 |
| Log Analytics | 16 |
| Application Security | 11 |
| Threat Observability | 11 |
| AI Observability | 9 |
| Business Observability | 8 |
| Software Delivery | 10 |
| **Total** | **111** |

### What Atlas helps you answer

- How much of the tenant is covered by key observability signals?
- Which capabilities are only partially adopted versus operationally mature?
- Where are the largest gaps in logs, traces, metrics, security, or automation?
- How is Gen3 adoption progressing across the environment?
- What changed between one assessment run and the next?

## How it works

Atlas uses a layered architecture:

1. **React + TypeScript UI** in `ui/`
2. **Strato-based views** for assessment cards, charts, review pages, and exports
3. **DQL execution** through Dynatrace SDK clients against Grail for metrics, logs, spans, events, Davis problems, entities, and business events
4. **App functions** in `api/` for app settings, platform APIs, and scheduled/server-side execution
5. **Document Store persistence** for snapshots and cached results

Core implementation areas:

- `ui/app/queries.ts` — Pulse Assessment criteria catalog
- `ui/app/hooks/useCoverageData.ts` — query orchestration and scoring
- `ui/app/tenantReview/` — Tenant Review experience
- `ui/app/observabilityEval/` — domain-based observability evaluation
- `shared/scoring.ts` — shared server-side scoring helpers

Important runtime behaviors already implemented in the codebase:

- **Economy Mode** lowers Grail scan cost by sampling safe queries and narrowing windows where needed.
- **Scale-tier execution** adapts to larger tenants.
- **Trace Proxy Mode** keeps assessments usable when trace entitlement is unavailable.
- **Snapshot history** stores previous runs for comparison and exports.

## Architecture at a glance

```text
Browser UI
  ├─ Pulse Assessment / Tenant Review / Observability Evaluation routes
  ├─ Dynatrace React hooks + SDK clients
  └─ PDF / export generation
        ↓
Dynatrace platform services
  ├─ Grail Query Service (DQL)
  ├─ Document Store
  ├─ App Settings
  └─ Environment / Automation APIs via app functions
```

For deeper implementation details, see:

- `docs/ARCHITECTURE.md`
- `docs/DATA-SOURCES.md`
- `docs/SCORING-CALCULATIONS.md`
- `CHANGELOG.md`

## Prerequisites

- **Node.js 20+**
- **npm 10+**
- Access to a Dynatrace tenant
- Dynatrace App Toolkit via `npx dt-app` or a global `dt-app` install
- Tenant permissions/scopes required by `app.config.json`

## Installation

```bash
git clone https://github.com/ricardojjulia/Atlas.git
cd Atlas
npm ci
```

Optional helper:

```bash
./setup.sh
```

`setup.sh` validates Node.js/npm, checks `app.config.json`, installs dependencies, and verifies the App Toolkit.

## Configuration

Atlas is configured primarily through `app.config.json`.

Key settings:

- `app.id` — deployed app identifier (`my.esa.tenant.evaluator`)
- `app.name` — app display name (`Atlas`)
- `environmentUrl` — target Dynatrace environment
- `app.scopes` — required read/write access for Grail, Documents, App Settings, Automation, Environment APIs, and related services

Guidance:

- Do **not** commit real tokens or new tenant secrets.
- If you need to target a different tenant locally, prefer passing `--environment-url` to the App Toolkit commands instead of editing tracked files permanently.

## Usage examples

### Run the app locally

```bash
npm run start
```

Or target a specific tenant without changing committed configuration:

```bash
npx dt-app dev --environment-url https://YOUR_TENANT.apps.dynatrace.com
```

### Build

```bash
npm run build
```

### Deploy

```bash
npx dt-app deploy --environment-url https://YOUR_TENANT.apps.dynatrace.com
```

### Uninstall

```bash
npx dt-app uninstall --environment-url https://YOUR_TENANT.apps.dynatrace.com
```

### Run the standalone evaluator CLI

Generate export artifacts without querying a tenant:

```bash
npm run tenant:evaluate -- --export-only
```

Generate a sample report:

```bash
npm run tenant:evaluate -- --sample-report
```

Run against a tenant:

```bash
DT_ENV_URL=https://YOUR_TENANT.apps.dynatrace.com \
DT_TOKEN=YOUR_TOKEN \
npm run tenant:evaluate
```

### Scheduled automation

Import `docs/workflow-scheduled-assessment.yaml` into Dynatrace Workflows to run scheduled server-side assessments and optional Slack notifications.

## Repository structure

```text
Atlas/
├── api/               # Dynatrace app functions
├── dashboards/        # Deployable dashboard artifacts
├── docs/              # Architecture, scoring, and operational documentation
├── settings/          # App settings schema
├── tools/             # Standalone utilities and CLI helpers
└── ui/                # React/TypeScript frontend
```

## Development, test, and build commands

| Command | Purpose |
| --- | --- |
| `npm run start` | Start local development with Dynatrace App Toolkit |
| `npm run build` | Produce a production build |
| `npm run deploy` | Deploy the app to a Dynatrace tenant |
| `npm run uninstall` | Remove the deployed app from a tenant |
| `npm run tenant:evaluate` | Run the standalone tenant evaluator CLI |
| `npm run dt:api:extract` | Export Dynatrace API metadata used by the repository |

### Test status

The repository includes Jest configuration for app functions (`api/jest.config.js`), but there is currently **no root `npm test` script and no checked-in test suite**. In practice, the main validation path in this repository is:

1. build successfully
2. run targeted manual verification against a Dynatrace tenant or the CLI sample/export modes

## Troubleshooting

### `dt-app` command not found

Use the bundled scripts (`npm run start`, `npm run build`, `npm run deploy`) or install the App Toolkit globally:

```bash
npm install -g dt-app
```

### Dependency or Strato import errors

Reinstall exact locked dependencies:

```bash
rm -rf node_modules
npm ci
```

### Scope or permission failures

Review the scopes listed in `app.config.json` and make sure the target tenant grants the required platform permissions.

### Trace data is unavailable

Atlas includes a trace proxy path for environments without trace entitlement, but trace-specific capabilities may be reduced or excluded by design.

### Build or local dev issues after pulling changes

```bash
npm ci
```

## Contributing

Contributions are welcome if they stay aligned with the repository's Dynatrace-app architecture.

Before opening a change:

- read `CONTRIBUTING.md`
- prefer `npm ci` over `npm install`
- keep tenant credentials, URLs, and sensitive local artifacts out of commits
- update documentation when behavior, commands, or scoring methodology changes

## Updates and release notes

- Human-readable release history lives in `CHANGELOG.md`
- Architecture and methodology notes live under `docs/`
- When releasing, review version-bearing metadata together so app/UI documentation stays aligned

## License

This repository is licensed under the **MIT License**. See `LICENSE`.
