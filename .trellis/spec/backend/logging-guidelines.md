# Logging Guidelines

> The executable logging contract for the Web SaaS Go backend.

---

## Ownership and Dependency Boundary

- `server/lib/logger` is the only package allowed to import `github.com/lifei6671/logit`.
- The direct dependency is pinned to `github.com/lifei6671/logit v1.0.0`; replace directives are forbidden.
- Services, repositories, workers, and HTTP code receive an injected `*slog.Logger` and may use only the
  typed context helpers exported by `lib/logger`.
- Never use package-level slog logging, `slog.Default`, `slog.With`, `slog.SetDefault`, a self-built
  Handler, `slog.Any`, a logger method value, or `Logger.Handler()` outside the adapter.
- Production log messages must be reviewed string literals. Dynamic messages are rejected by the build
  contract because the safe Handler does not inspect message contents.

## Constructor and Output

Use `logger.New(logger.Options)` to construct the process logger. The options are limited to an output
writer, trusted service/version tokens, the minimum slog level, and a no-argument writer-error hook.

- A nil writer means stdout; tests may inject an `io.Writer`.
- Output is one JSON object per line with the fixed base keys
  `timestamp`, `level`, `message`, `service`, and `version`.
- The production minimum is Info. Source output stays disabled so local absolute paths are not emitted.
- `service` and `version` are trusted constructor fields and cannot be overridden by record attributes.
- Writer failures do not expose the original error. A non-reentrant guard suppresses writes through the
  same logger while its hook runs, and hook panics are isolated so recursion cannot deadlock the request.
- G0-T09 has no logging YAML, text/file Handler, rotation, dispatch, or close lifecycle.

## Typed Context

`NewContext(parent, ContextFields)` creates a fresh logit field store. `ForkContext` clones an existing
store for a child operation and preserves cancellation and deadlines.

Allowed context fields are:

- request shape: `direction`, `method`, `route_template`, `operation`, `peer_service`;
- correlation: `request_id`, `trace_id`, `user_id`, `task_id`, `invocation_id`.

Inbound contexts require a route template. Outbound contexts require operation and peer service. Methods
are limited to GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, CONNECT, TRACE, and the fixed normalized value
OTHER. G0-T05 maps every non-standard raw method to OTHER before creating the context; attacker-controlled
method text must never enter logs. Route templates and tokens have strict byte limits and character
allowlists; schemes, hosts, query strings, fragments, whitespace, CRLF, and path traversal are rejected
without echoing the input.

A fork inherits request, trace, user, and task IDs. Supplying a different value fails. Direction, method,
operation, peer service, and invocation describe the child call; stale parent route/invocation fields are
removed, and parent or sibling stores are not mutated. ID provenance and generation remain owned by the
HTTP and domain tasks that supply each ID.

## Completion Event and Levels

`LogRequestComplete` writes the literal message `HTTP 请求完成`. The record allowlist contains only:

- `status_code`: integer HTTP status from 100 through 599;
- `error_code`: positive stable application error code, omitted when zero;
- `elapsed_ms`: non-negative integer duration.

Statuses 100-399 log at Info, 400-499 at Warn, and 500-599 at Error. An outbound transport failure may use
status zero only with a positive error code; the status field is then omitted and the event logs at Error.
Inbound completion always requires a valid HTTP status.

## Leakage Boundary

The application safe Handler checks the original `slog.Value.Kind` and never resolves a LogValuer. It
drops unknown attributes, groups, `slog.Any`, errors, byte slices, objects, and invalid result values.
Entering a non-empty slog group drops every group-scoped attribute and does not forward the group name.

Never log configuration YAML/JSON, DSNs, credentials, API keys, session or verification keys,
Authorization/Cookie values, raw or system prompts, provider raw requests/responses/errors/headers, SSE
text, image/file Base64, original file contents, complete URLs/queries, absolute paths, or wrapped causes.
Application errors are represented only by a stable integer `error_code` and a fixed reviewed message.

Adding another structured field requires an owning task, a fixed name and scalar type, provenance rules,
and final-writer leakage tests. Do not replace the allowlist with a sensitive-key blacklist or heuristic
redaction.

## Required Verification

Run from `server/`:

```bash
gofmt -l ./lib/logger ./internal/buildcontract
go mod tidy -diff
go mod verify
go vet ./...
go test -count=1 ./lib/logger ./internal/buildcontract
go test -shuffle=on -count=50 ./lib/logger
go test -race -count=1 ./...
```

`internal/buildcontract/logging_contract_test.go` is an executable source/dependency guard. Black-box
tests must exercise the final writer through slog, the safe Handler, and logit, including adversarial
Config values, Base64 markers, LogValuer non-resolution, concurrent forks, and recursive writer failure.

## Future Owners

Gin middleware, CORS, inbound completion assembly, and response mapping belong to G0-T05. Request ID
issuance/header, trusted proxy parsing, and CrossOriginProtection belong to G0-T06 and reuse the same typed
user/admin Origin allowlists. Startup/flush ownership belongs to G0-T07; metrics and tracing to G0-T10.
Provider, Blob, SMTP, and audit fields are added only by their owning business tasks. Do not document those
integrations as complete at G0-T09.
