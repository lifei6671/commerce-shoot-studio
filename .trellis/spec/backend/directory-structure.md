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
├── go.mod
├── cmd/server/main.go
└── internal/buildcontract/module_contract_test.go
```

---

## Module Organization

- `cmd/server` owns only process composition and startup.
- `internal/buildcontract` contains test-only assertions for the module and build toolchain.
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
- G0-T01 has no third-party dependency and therefore produces no `go.sum`.
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
