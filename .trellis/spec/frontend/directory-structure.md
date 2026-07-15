# Directory Structure

> Current Web tooling boundary and its separation from the Desktop application.

---

## Overview

The existing `desktop/` package remains the local Tauri product. G0-T04 introduces a separate tooling-only
`web/` npm package solely to own the TypeScript OpenAPI generator, lockfile, and committed transport types.
It is not yet a runnable Web application; G5-T01 adds React, routes, UI systems, and build output later.

---

## Current Web Layout

```text
web/
├── package.json
├── package-lock.json
└── src/api/generated/openapi.ts
```

---

## Module Organization

- `web/src/api/generated/openapi.ts` is generated from `server/api/openapi.yaml` and is never hand-edited.
- User and admin Web clients may later share the transport types, but they must keep authentication state and
  authorization handling separate.
- Future Remote mappers convert generated HTTP DTOs to Runtime Port views. UI components do not cast or expose
  raw transport payloads directly.
- Do not import the Web generated file into `desktop/`, modify the Desktop package/lockfile, or turn the root
  repository into an npm workspace.
- G0-T04 installs no React, Ant Design, Vite, Tailwind, Radix, shadcn, routes, components, or global CSS.

---

## Generation

- `openapi-typescript` is pinned exactly to `7.13.0` in the independent Web lockfile.
- The generation script accepts only `../server/api/openapi.yaml` and writes only
  `src/api/generated/openapi.ts`.
- `--default-non-nullable false` preserves optional request fields whose server-side defaults are documented
  by OpenAPI.
- Use `npm ci --prefix web` before generation in a clean environment and review the generated diff.
