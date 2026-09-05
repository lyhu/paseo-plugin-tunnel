# Project Maintenance Guidelines

Rules and standards for autonomous agents and contributors maintaining this repository:

---

## 1. Changelog Discipline
- **When to Update**: Record all user-visible features, bug fixes, security modifications, and installation changes in [CHANGLOG.md](CHANGLOG.md).
- **Format**: Keep entries concise and grouped under the `## Unreleased` section.
- **Categorization**: Use standard Keep a Changelog categories (`### Added`, `### Changed`, `### Fixed`, `### Removed`).

---

## 2. Release Preparation
- **Version Alignment**: Keep version numbers synchronized across `package.json`, `package-lock.json`, and release tags.
- **Changelog Promotion**: Move pending entries from `## Unreleased` into a newly created version header (`## X.Y.Z — YYYY-MM-DD`).
- **Release Notes**: Generate or update corresponding release summaries under `docs/releases/vX.Y.Z.md`.

---

## 3. Multi-Language Documentation Parity
- Keep English [README.md](README.md) and Simplified Chinese [docs/README.zh-CN.md](docs/README.zh-CN.md) strictly aligned whenever behavior, CLI commands, or UI flows change.
- Ensure technical terminology (e.g., Ingress, Egress, Route Offer, Access Token) is consistently rendered across translations.
