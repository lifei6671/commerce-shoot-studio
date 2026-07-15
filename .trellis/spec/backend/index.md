# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Go module root, toolchain contract, and current server layout | Active |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | To fill |
| [Error Handling](./error-handling.md) | Stable integer codes, safe messages, wrapping, and package ownership | Active |
| [OpenAPI Contract](./openapi-contract.md) | Reviewed schema ownership, generated transports, and incremental operations | Active |
| [Quality Guidelines](./quality-guidelines.md) | Code standards and structured AI output validation | Active |
| [Logging Guidelines](./logging-guidelines.md) | slog/logit ownership, structured fields, and leakage guards | Active |
| [HTTP Guidelines](./http-guidelines.md) | Gin routing, CORS, safe errors, body limits, recovery, and server construction | Active |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
