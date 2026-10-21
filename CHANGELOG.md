# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.3] - 2026-10-21

### Changed
- Package author contact set to a monitored mailbox.

## [1.0.2] - 2026-10-21

### Changed
- Releases are published through npm trusted publishing (GitHub Actions OIDC); no npm token is stored.

## [1.0.1] - 2026-10-21

### Changed
- Documentation uses generic placeholders for hosts, paths and IDs.

## [1.0.0] - 2026-10-21

First public release.

### Added
- Smartsheet Trigger node using Smartsheet webhooks: row added/updated/deleted, cell updated (optionally
  limited to watched columns), comment and comment thread events, attachment events, column events and
  sheet updates. Handles the verification challenge, verifies the HMAC signature, re-enables webhooks
  Smartsheet has disabled, resolves rows/comments/attachments/columns, and reports `changedColumns`.
- Smartsheet action node with resources Row (add, update, create-or-update, get, get many, search,
  delete, copy, move), Sheet (get, get many, create, copy, move, rename, delete, export), Column,
  Attachment (including upload and download), Comment, Folder, Workspace, Report, Search and User.
- Column mapper for Row operations with automatic mapping from input data, matching on Row ID or on any
  column, and cell conversion by column type (checkbox, dropdowns, contacts, dates, formulas).
- Simplified row output keyed by column title, with `sheetId` and `sheetName` on every row.
- Smartsheet API credential with region selection (Global, EU, US Government).
- Example workflows in `examples/`.
- GitHub Actions workflows for CI and provenance-based npm publishing.

### Changed
- Package published as `@bluskytech/n8n-nodes-smartsheet` because plain `n8n-nodes-smartsheet` belongs
  to an unrelated package on npm. Node type IDs are `@bluskytech/n8n-nodes-smartsheet.smartsheet` and
  `@bluskytech/n8n-nodes-smartsheet.smartsheetTrigger`.

## [0.2.0] - 2026-10-21
- Package rename (see above).

## [0.1.2] - 2026-10-20
- Use the official Smartsheet logo mark as the node and credential icon.

## [0.1.1] - 2026-10-20
- Add `sheetName` and `sheetPermalink` to trigger items and simplified rows.

## [0.1.0] - 2026-10-20
- Initial internal release.
