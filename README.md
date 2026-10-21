# @bluskytech/n8n-nodes-smartsheet

A community node package that brings [Smartsheet](https://www.smartsheet.com) into [n8n](https://n8n.io),
modelled on the Zapier Smartsheet integration: add one credential, then use Smartsheet either as a
**trigger** (new or updated rows, comments, attachments, cell changes) or as an **action** (rows,
sheets, columns, attachments, comments, folders, workspaces, reports, search).

Source: <https://github.com/bluskytech/n8n-nodes-smartsheet>

## Contents

- [Credentials](#credentials)
- [Smartsheet node (actions)](#smartsheet-node-actions)
- [Smartsheet Trigger node](#smartsheet-trigger-node)
- [Installation](#installation)
- [Example workflows](#example-workflows)
- [Development](#development)
- [Releasing](#releasing)

## Credentials

Create a **Smartsheet API** credential in n8n with:

| Field        | Value                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------- |
| Access Token | A personal API token. In Smartsheet: Account > Apps & Integrations > API Access > Generate.  |
| Region       | Global (`api.smartsheet.com`), EU (`api.smartsheet.eu`) or US Government (`api.smartsheetgov.com`). |

The credential test calls `GET /users/me`. Everything the node does is done as the user who owns the token.

## Smartsheet node (actions)

| Resource   | Operations                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------- |
| Row        | Add, Update, Create or Update (upsert), Get, Get Many, Search, Delete, Copy, Move           |
| Sheet      | Get (with rows), Get Many, Create, Copy, Move, Rename, Delete, Export (PDF / Excel / CSV)   |
| Column     | Get Many, Get, Create, Update, Delete                                                       |
| Attachment | Get Many, Get, Download, Upload File, Add Link, Delete                                       |
| Comment    | Get Many, Create (new thread or reply), Get, Get Thread, Delete                             |
| Folder     | Get, Get Many, Create, Copy, Move, Rename, Delete                                            |
| Workspace  | Get Many, Get, Create, Copy, Rename, Delete                                                  |
| Report     | Get Many, Get (with rows)                                                                    |
| Search     | Search Everything                                                                            |
| User       | Get Current User, Get Many                                                                   |

Highlights:

- **Pick sheets, folders, workspaces and reports from a list** instead of pasting IDs (an ID mode is
  there too for expressions).
- **Row Add / Update / Upsert use a column mapper.** The node loads the sheet's columns and shows one
  field per column, with auto-mapping from incoming data. System columns (auto-number, created by,
  modified date, ...) and column formulas are hidden because Smartsheet will not let you write them.
- **Update and Upsert can match on Row ID or on any column.** Matching on a column scans the sheet and
  updates the first (or every) matching row. Upsert adds the row when nothing matches.
- **Rows are simplified by default:** each row comes out as a flat object keyed by column title, with
  `sheetId`, `sheetName`, `id`, `rowNumber`, `createdAt`, `modifiedAt` and friends alongside. Turn **Simplify** off to get
  Smartsheet's raw `cells` array. **Cell Value Source** switches between raw values and display text.
- **Cell values are converted by column type:** checkboxes accept true/false/yes/no, multi-select
  dropdowns and multi-contact columns accept arrays or comma-separated text, contacts accept
  `email` or `Name <email>`, and a value starting with `=` is written as a formula.
- **Row Search** finds rows by a column condition (equals, contains, starts with, is empty, ...) or by
  Smartsheet full-text search.
- **Sheet Export** and **Attachment Download / Upload** work with n8n binary data.

## Smartsheet Trigger node

Uses Smartsheet's native webhooks, so there is no polling schedule to configure. Smartsheet batches
changes and delivers them roughly once a minute, so one workflow run may contain several events (one
item each, in chronological order). Pick a sheet and the events you care about:

| Event                 | Fires when                                         |
| --------------------- | -------------------------------------------------- |
| Row Added / Updated / Deleted | A row is created, changed or removed         |
| Cell Updated          | One event per changed cell (optionally only in watched columns) |
| Comment Added / Deleted, Comment Thread Started | Discussions and comments change |
| Attachment Added / Deleted | Files or links are attached                     |
| Column Added / Updated / Deleted | The sheet structure changes               |
| Sheet Updated         | Sheet-level changes such as a rename              |

Smartsheet webhooks only carry IDs, so with **Resolve Event Data** (on by default) the trigger fetches
the row, comment, attachment or column for each event. Every item carries `sheetId`, `sheetName` and
`sheetPermalink`. Row events include the simplified `row` plus `changedColumns` for updates; cell
events include `columnTitle`, `newValue` and `newDisplayValue`.

Other options:

- **Watch Columns** limits cell events to specific columns (Smartsheet `subscope`).
- **Ignore Changes Made by This Credential** drops events caused by the token's own user, which stops
  loops when the same workflow writes back to the sheet.

How the webhook lifecycle works:

1. On activation the node deletes any stale Smartsheet webhook pointing at the same n8n URL, creates a
   new one scoped to the sheet, and enables it. Smartsheet verifies the callback with a challenge that
   the node answers automatically.
2. Every callback is checked against the shared secret Smartsheet issued (HMAC-SHA256) before anything
   runs.
3. If Smartsheet disables the webhook (for example after your n8n was unreachable for a while), the
   node re-enables it the next time the workflow is activated.
4. On deactivation the webhook is deleted.

Requirements: the n8n webhook URL must be **public HTTPS**. Set `N8N_WEBHOOK_URL=https://n8n.example.com/`
(n8n 2.x; older versions use `WEBHOOK_URL`). Smartsheet refuses `http://` and private addresses.

## Installation

The package is published under the `@bluskytech` scope rather than as plain `n8n-nodes-smartsheet`
because an unrelated package already holds that name on the public npm registry, and n8n's node panel
shows the npm listing for whatever package name it finds. The git repositories keep the shorter name.

### Option A: GUI install from npm (if the package is published)

Settings > Community Nodes > Install, enter `@bluskytech/n8n-nodes-smartsheet`.

### Option B: install from a tarball on a Docker Compose host

1. Build the tarball on any machine with Node 20+:

   ```bash
   git clone https://github.com/bluskytech/n8n-nodes-smartsheet.git
   cd n8n-nodes-smartsheet
   npm install
   npm run pack
   ```

   This produces `bluskytech-n8n-nodes-smartsheet-<version>.tgz`.

2. Copy the tarball into the n8n data volume on the host (the directory mounted at `/home/node/.n8n`),
   then install it from inside the container:

   ```bash
   docker compose cp bluskytech-n8n-nodes-smartsheet-1.0.3.tgz n8n:/home/node/.n8n/
   docker compose exec n8n sh -c 'mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes && (test -f package.json || npm init -y >/dev/null) && npm install ~/.n8n/bluskytech-n8n-nodes-smartsheet-1.0.3.tgz --omit=dev --omit=peer'
   docker compose restart n8n
   ```

   `--omit=peer` matters: without it npm tries to install `n8n-workflow` and its native dependencies
   next to the node, which is slow and unnecessary (n8n provides it).

3. Make sure the compose file sets `N8N_WEBHOOK_URL` (or `WEBHOOK_URL` on n8n 1.x) to the public
   HTTPS address, which the trigger needs, and that `N8N_COMMUNITY_PACKAGES_ENABLED` is not `false`.

4. In n8n, add a **Smartsheet API** credential and the nodes appear under "Smartsheet".

To upgrade, repeat step 2 with the new tarball and restart.

### Updating a tarball install over SSH

If the Docker host has no SFTP, stream the tarball over plain SSH and install it inside the container.
Replace the user, host, data path and container name with your own:

```bash
npm run pack
ssh user@docker-host 'cat > /path/to/n8n-data/bluskytech-n8n-nodes-smartsheet-1.0.3.tgz' < bluskytech-n8n-nodes-smartsheet-1.0.3.tgz
ssh user@docker-host 'docker exec n8n sh -c "cd /home/node/.n8n/nodes && npm install /home/node/.n8n/bluskytech-n8n-nodes-smartsheet-1.0.3.tgz --omit=dev --omit=peer" && docker restart n8n'
```

The path inside the container is `/home/node/.n8n` on the official image, or `/root/.n8n` if the
container runs as root. Bump the version in `package.json` for every change so the tarball name moves on.

## Example workflows

Import any of these from `examples/` via Workflows > Import from File, then pick your sheet and
credential in each Smartsheet node:

| File | What it does |
| ---- | ------------ |
| `examples/row-added-to-slack.json` | Posts to Slack whenever a row is added, including the sheet name and row link |
| `examples/form-to-row.json` | An n8n Form that adds a row, with form fields auto-mapped to columns by title |
| `examples/row-updated-add-comment.json` | Comments on every edited row listing the changed columns, without re-triggering itself |

## Development

```bash
npm install
npm run build      # compile to dist/
npm run lint       # n8n community node linter
npm run dev        # starts a local n8n with the node loaded and hot reload
npm run pack       # build + npm pack
```

Project layout:

```
credentials/SmartsheetApi.credentials.ts   credential + test request
nodes/Smartsheet/Smartsheet.node.ts        action node (resource switch)
nodes/Smartsheet/resources/*.ts            one file per resource: description + execute
nodes/Smartsheet/shared/transport.ts       authenticated request helper with retry
nodes/Smartsheet/shared/utils.ts           row simplification, cell building by column type
nodes/Smartsheet/shared/methods.ts         list search, column loader, resource mapper schema
nodes/SmartsheetTrigger/SmartsheetTrigger.node.ts  webhook trigger
```

## Releasing

Releases are published to npm from GitHub Actions with an npm provenance statement, which n8n requires
for community nodes. `.github/workflows/publish.yml` runs on every `x.y.z` tag.

1. One-time: on npmjs.com add GitHub Actions as a trusted publisher for this package (repository owner,
   repository name, workflow `publish.yml`), or store a granular npm token as the `NPM_TOKEN` Actions
   secret.
2. Run `npm run release` locally. It lints, builds, prompts for the version bump, updates
   `CHANGELOG.md`, commits, tags and pushes. The tag push triggers the publish workflow.
3. After the package is on npm, submit it at <https://creators.n8n.io/nodes> for verification.

`npm run pack` still produces a tarball for manual installs as described under Installation.

## Trademark note

The node icon is the Smartsheet logo mark taken from smartsheet.com. Smartsheet is a trademark of
Smartsheet Inc.; this package is an independent community integration and is not affiliated with or
endorsed by Smartsheet.

## License

MIT
