# Directory Structure

> How backend code is organized in this project.

---

## Overview

The Web SaaS backend is an independent Go module rooted at `server/`. Only directories that contain
real source files are created; future G0 tasks add their own packages when their contracts are implemented.

---

## Directory Layout

```text
server/
├── api/
│   ├── generate.go
│   ├── oapi-codegen.yaml
│   └── openapi.yaml
├── conf/
│   └── app.yaml.example
├── go.mod
├── go.sum
├── lib/
│   ├── apperror/
│   │   ├── catalog.go
│   │   ├── catalog_test.go
│   │   ├── error.go
│   │   └── error_test.go
│   └── constant/
│       ├── async_job_status.go
│       ├── constant_test.go
│       └── model_category.go
├── cmd/server/main.go
└── internal/
    ├── buildcontract/module_contract_test.go
    ├── buildcontract/openapi_contract_test.go
    ├── models/dto/generated/types.gen.go
    └── config/
        ├── config.go
        ├── loader.go
        ├── loader_test.go
        ├── runtime_document.go
        └── runtime_document_test.go
```

---

## Module Organization

- `cmd/server` owns only process composition and startup.
- `internal/buildcontract` contains test-only assertions for the module and build toolchain.
- `internal/config` owns startup YAML loading, work-directory derivation, typed validation, and
  the storage-independent runtime JSON document decoding boundary.
- `api/openapi.yaml` is the only reviewed HTTP transport source. `api/generate.go` and
  `api/oapi-codegen.yaml` generate models only; Gin server wrappers belong to G0-T05.
- `internal/models/dto/generated` contains committed generated HTTP DTOs and is never edited manually.
- `lib/apperror` is the sole source of stable integer error codes, HTTP mappings, safe public messages,
  and wrapped causes. It has no Gin, OpenAPI, response, or logger dependency.
- `lib/constant` owns strongly typed persisted statuses and stable domain enums. Keep each domain in its
  own file and never create a generic `status.go` or duplicate application error codes here.
- `conf/app.yaml.example` is the only tracked startup configuration template. It documents every current
  field in Simplified Chinese and contains no deployable credentials. Users copy or rename it to
  Git-ignored `conf/app.yaml`, or explicitly pass another complete `app.yaml`; the example is never loaded
  automatically or inherited as defaults.
- Do not create placeholder package trees or `.gitkeep` files. Add a package only with its first real
  implementation file.

---

## Naming Conventions

- The module path is `github.com/lifei6671/commerce-shoot-studio/server`.
- Go package and directory names use lowercase names without separators.
- Production and test code comments that explain business or project boundaries use Simplified Chinese.

---

## Examples

- Process entry: `server/cmd/server/main.go`.
- Executable module contract: `server/internal/buildcontract/module_contract_test.go`.
- Application-error contract: `server/lib/apperror/catalog.go` and `server/lib/apperror/error.go`.
- Persisted status and enum contracts: `server/lib/constant/async_job_status.go` and
  `server/lib/constant/model_category.go`.

## Scenario: Web SaaS Go module and toolchain contract

### 1. Scope / Trigger

- Trigger: any Go command, package, test, CI job, or build script added under `server/`.

### 2. Signatures

- Module path: `github.com/lifei6671/commerce-shoot-studio/server`.
- Language directive: `go 1.26.0`.
- Toolchain directive and required runtime: `toolchain go1.26.5` / `runtime.Version() == "go1.26.5"`.
- Process entry: `func main()` in `server/cmd/server/main.go`.

### 3. Contracts

- Run Go commands from `server/` unless a repository command explicitly changes into that directory.
- Let the Go tool select and download `go1.26.5`; success from another local Go patch version is not
  acceptance evidence.
- G0-T01 itself introduced no third-party dependency. Later tasks manage `go.sum` only through Go module
  commands; never edit it manually.
- The initial process entry has no network listener, configuration read, database connection, or worker.
  Those behaviors belong to later checklist tasks.
- Tests locate `go.mod` from their source file with `runtime.Caller` and `filepath`; never embed a local
  absolute path or a platform-specific separator.

### 4. Validation & Error Matrix

- Missing or changed `module` directive -> `TestModuleContract` fails with the actual and expected path.
- Missing or changed `go` directive -> `TestModuleContract` fails with the actual and expected version.
- Missing or changed `toolchain` directive -> parsing or contract assertion fails explicitly.
- Go command does not run with `go1.26.5` -> `TestRuntimeUsesPinnedToolchain` fails.
- `go.mod` cannot be read -> the contract test fails with a wrapped file-read error.

### 5. Good/Base/Bad Cases

- Good: a developer with an older compatible bootstrap Go runs `go test ./...`; Go selects `go1.26.5`
  and every contract test passes.
- Base: `go run ./cmd/server` builds and exits without external side effects during G0-T01.
- Bad: a local absolute path is embedded in a test, or a future HTTP server is added before the logging
  baseline and lifecycle tasks are complete.

### 6. Tests Required

- Assert module path, language version, toolchain directive, and actual runtime version exactly.
- Keep a malformed or missing-field fixture so the test parser has an independently verified failure path.
- Run `gofmt -l`, `go mod verify`, `go vet ./...`, `go test ./...`, and `go test -race ./...`.
- Run `go run ./cmd/server` while the entry is intentionally side-effect free.

### 7. Wrong vs Correct

#### Wrong

```go
moduleFile := "/Users/example/project/server/go.mod"
```

#### Correct

```go
_, filename, _, _ := runtime.Caller(0)
moduleFile := filepath.Join(filepath.Dir(filename), "..", "..", "go.mod")
```

## Scenario: Startup configuration boundary

### 1. Scope / Trigger

- Trigger: adding or changing startup configuration under `server/conf` or `server/internal/config`.

### 2. Signatures

- Loader: `config.Load(path string) (config.Config, error)`; an empty path means process-working-directory
  `conf/app.yaml`.
- Runtime source port: `ReadRuntimeDocument(context.Context, string) ([]byte, error)`.
- Runtime document contract: strict JSON decoding followed by `Validate() error`.

### 3. Contracts

- The directory immediately above the loaded `app.yaml` file is the configuration work directory. A
  default `<process-workdir>/conf/app.yaml` therefore uses `<process-workdir>/conf`, and an explicitly
  passed file follows the same rule.
- The YAML file first rejects any additional YAML document and audits mapping keys for case/whitespace
  semantic duplicates, then uses a fresh
  Viper instance and exact mapstructure decoding with weak input conversion disabled. Because Viper
  lowercases map keys, restore `dsn_params` keys from the same audited YAML document after strict structure
  decoding. Do not use global Viper state, environment binding, defaults, search paths, merging, or watchers.
- One `app.yaml` directly contains the complete MySQL, Session, Security, and conditional Redis sections.
  It does not reference domain YAML files. An explicit configuration file is complete and standalone; never
  fall back to the default file or repository example.
- Cookie mode does not require Redis configuration. Redis mode requires its inline section and never falls
  back to Cookie mode. Redis `password` is optional for explicitly approved no-auth private-network deployments;
  address, database, pool, key prefix, TLS flag, and timeouts remain strictly typed and validated.
- Startup secrets are standard Base64 and are decoded only into memory. Errors name fields and rules but do
  not include original values, complete YAML/JSON, DSNs, or secret markers.
- Runtime JSON decoding remains storage-independent. Database schema, fixed business keys, and domain JSON
  types are added by their owning G1 tasks.

### 4. Validation & Error Matrix

- Unknown field, weak type conversion, malformed or multi-document YAML, invalid enum, or missing required credential -> fail
  startup. MySQL and startup keys remain required; an empty Redis password is valid no-auth configuration.
- Explicit configuration path missing or invalid -> fail without trying the default file or example.
- Reserved `dsn_params` key, regardless of case -> reject without formatting the complete map.
- Invalid Base64, wrong decoded length, key reuse, or non-shorter admin TTL -> fail validation.
- Runtime source failure -> preserve the error chain but expose only a stable outer message.
- Runtime unknown field, wrong type, or trailing JSON -> reject without returning the raw document.

### 5. Good/Base/Bad Cases

- Good: `Load("/etc/commerce-shoot-studio/conf/app.yaml")` loads one complete document and reports
  `/etc/commerce-shoot-studio/conf` as the work directory.
- Base: `Load("")` loads `conf/app.yaml` relative to the current process working directory.
- Bad: enabling `AutomaticEnv`, merging repository templates into an external deployment, or logging a
  decoded configuration value.

### 6. Tests Required

- Cover default and explicit entry points, work-directory derivation, explicit failure without fallback,
  environment/global Viper isolation, strict types and unknown fields, Redis conditional loading, DSN
  reserved keys, precise key lengths and isolation, credential-free annotated repository example, Git ignore
  contract, marker non-leakage, and strict runtime JSON.
- Run `gofmt -l`, `go mod verify`, `go vet ./...`, `go test ./...`, and `go test -race ./...`.
