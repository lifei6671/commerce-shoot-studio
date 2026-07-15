# Error Handling

> Stable application-error contracts for the Web SaaS Go runtime.

---

## Overview

`server/lib/apperror` is the single source of truth for stable integer error codes, HTTP status mappings,
safe Simplified Chinese messages, and wrapped causes. Services depend on this package without importing Gin,
OpenAPI-generated DTOs, response writers, or logging implementations.

`server/lib/constant` must not duplicate error codes. It owns only strongly typed persisted statuses, stable
domain enums, and other genuinely cross-module constants.

---

## Error Types

- `apperror.Code` is a named `int` type.
- `apperror.Error` has private code, HTTP status, safe-message, and cause fields.
- Catalog definitions are package-level sentinels with private fields created inside `apperror`; callers may
  read them through `Code()`, `HTTPStatus()`, and `SafeMessage()` and must not reassign the exported variables.
- `Wrap(cause)` returns the original sentinel for a nil cause and otherwise creates a value with the same
  public contract and a standard `Unwrap()` chain.
- `errors.Is` identifies application errors by stable code. `errors.As` retrieves `*apperror.Error`.

The initial HTTP catalog contains exactly these mappings:

| Name | Code | HTTP | Safe message |
| --- | ---: | ---: | --- |
| `INVALID_REQUEST` | 100400 | 400 | 请求参数无效 |
| `METHOD_NOT_ALLOWED` | 100405 | 405 | 请求方法不允许 |
| `REQUEST_BODY_TOO_LARGE` | 100413 | 413 | 请求体过大 |
| `INTERNAL_ERROR` | 100500 | 500 | 服务暂时不可用 |
| `GENERATION_TASK_NOT_FOUND` | 140404 | 404 | 生成任务不存在 |
| `AI_REWRITE_IN_PROGRESS` | 150409 | 409 | AI 改写正在处理中 |

`GENERATION_PROVIDER_RESULT_UNCERTAIN=140504` is currently a task-result code only. It has no synchronous
HTTP mapping or public `Error` sentinel until an owning HTTP use case defines that contract.

---

## Error Handling Patterns

- Return or wrap a catalog error at service and infrastructure boundaries; preserve the original cause for
  `errors.Is` / `errors.As` and internal diagnostics.
- Public error strings contain only the registered safe message. Never append SQL, paths, provider responses,
  prompts, credentials, configuration values, or the cause text.
- HTTP status and application code are independent facts. Never derive one from the other.
- The fixed code ranges are: `100xxx` common, `110xxx` authentication, `120xxx` user, `130xxx` asset,
  `140xxx` generation, `150xxx` model, `160xxx` configuration/mail, `170xxx` credit, and `190xxx` admin.
- New codes, mappings, or public messages are contract changes and require explicit approval plus catalog tests.

---

## API Error Responses

G0-T03 does not write HTTP responses. G0-T04 owns the OpenAPI error DTO, and G0-T05 owns Gin response mapping.
Those layers must consume `apperror.Error`; they must not create a second error catalog or return raw causes.

---

## Common Mistakes

- Defining error-code constants in `lib/constant` as well as `lib/apperror`.
- Using string error codes or deriving a code from an HTTP status.
- Exposing `cause.Error()` through `Error()`, JSON, logs, or DTOs.
- Adding Gin, response JSON, or generated DTO dependencies to `lib/apperror`.
- Assigning HTTP 504 to `140504` merely because the code ends in `504`.
