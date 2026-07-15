# OpenAPI Contract

> Ownership and generation rules for the Web SaaS HTTP transport contract.

---

## Source and Outputs

- `server/api/openapi.yaml` is the only reviewed OpenAPI source and is fixed to OpenAPI 3.0.3.
- Every `$ref` must start with `#/`; external files, URLs, overlays, remote templates, user input, and
  third-party schemas are forbidden.
- `oapi-codegen v2.7.2` generates models only into
  `server/internal/models/dto/generated/types.gen.go`.
- `openapi-typescript 7.13.0` is pinned by `web/package-lock.json` and generates
  `web/src/api/generated/openapi.ts`.
- Generated files are committed for review and must never be edited manually.

---

## Incremental Operation Contract

G0-T04 starts with a valid empty `paths` object and only the shared components whose fields are already
approved. The route inventory in the Web SaaS technical plan remains authoritative, but an owning G2-G6
task adds an operation only after its request, success response, error responses, authentication, idempotency,
and pagination fields are frozen.

Never use an unconstrained object, an empty success body, or free `additionalProperties` to make an unfinished
operation look complete. Every future operation must use GET or POST, have a globally unique `operationId`,
and regenerate both Go and TypeScript outputs in the same change.

---

## Layer Boundaries

- Generated types are HTTP transport DTOs. They are not GORM entities, service commands/views, Runtime Port
  types, page view-models, or persisted task snapshots.
- G0-T04 does not generate Gin wrappers. G0-T05 owns Gin registration, binding, request IDs, body limits,
  and safe mapping from `apperror.Error` to `ErrorResponse`.
- The Desktop package, lockfile, TypeScript configuration, Runtime Ports, adapters, and UI do not consume the
  Web generated transport file.
- The Web Remote mapper introduced later converts generated transport DTOs to Runtime Port views.

---

## Security and Streaming

- Do not declare CSRF tokens, cookies, or headers. Browser writes are protected by same-origin sessions and
  `net/http.CrossOriginProtection` in later HTTP tasks.
- Deployment configuration owns user/admin Cookie names. Because OpenAPI cookie security schemes require a
  static name, G0-T04 does not invent one; operation security is frozen with the owning authentication task.
- `Idempotency-Key` is an opaque required header component. Do not add an unapproved UUID format, character
  set, or length limit.
- Only AI assist rewrite uses `text/event-stream`. OpenAPI owns the meta/delta/done/error payload shapes; frame
  ordering, JSON serialization, flush, heartbeat, backpressure, cancellation, and terminal-state behavior
  require executable tests in the owning HTTP/service task.
- Raw prompts/requests/responses, Base64, absolute paths, internal reconciliation fields, and provider raw
  data must never enter public schemas. A future authentication or credential-update task may add an explicit
  credential input field only in a request schema with `writeOnly: true`; credential values must never appear
  in a response/view schema.

---

## Required Checks

- Contract tests inject bad fixtures for remote/escaping refs, non-GET/POST methods, duplicate operation IDs,
  CSRF fields/header names, and universally forbidden raw fields. Empty paths alone are not proof of those
  rules. The initial frozen component set uses exact schema/property allowlists.
- Reviewed SHA-256 snapshots cover the OpenAPI source and both generated outputs so an isolated hand edit
  fails tests. After the outputs are staged, re-run both generators and require a clean generated-file diff.
- Run `go generate ./api` from `server/` and `npm run --prefix web generate:openapi` from the repository root.
- Re-running both generators must leave the committed outputs byte-identical.
- Run Go formatting, vet, tests, Race tests, npm audit, SBOM/license checks, and review every schema/generated
  diff. G0-T12 owns the final unified Makefile and CI entry.
