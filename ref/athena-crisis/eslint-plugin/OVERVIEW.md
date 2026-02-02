# eslint-plugin Overview

## Purpose and role
`eslint-plugin/` is a tiny, local ESLint plugin that encodes Athena Crisis–specific correctness and architecture rules that generic linting does not cover. It enforces:

- Immutable copy usage (do not discard `.copy()` results).
- Centralized timekeeping via `dateNow()` rather than `Date.now()`.
- Static (module-top-level) CSS-in-JS definitions.
- A custom lazy-loading wrapper with game-specific error handling.

This package is used by the monorepo root ESLint config, so these rules apply across all workspace packages when `pnpm lint` runs.

## Package layout

- `eslint-plugin/index.js`: Plugin entry point. Exports rule implementations and a `strict` config that enables them.
- `eslint-plugin/no-copy-expression.js`: Rule to prevent ignoring `.copy()` return values.
- `eslint-plugin/no-date-now.js`: Rule that forbids `Date.now()` and auto-fixes to `dateNow()`.
- `eslint-plugin/no-inline-css.js`: Rule that restricts `css\`\`` tagged templates to top-level module scope.
- `eslint-plugin/no-lazy-import.js`: Rule that forbids `import { lazy } from 'react'`.
- `eslint-plugin/package.json`: Declares the plugin as `@deities/eslint-plugin`, ESM-only.

There are no tests or build steps in this package. ESLint loads it directly as ESM.

## Public interface (ESLint plugin API)

The plugin exports a default object with these keys:

- `meta.name`: `@deities` (the namespace used for rule IDs).
- `rules`: a map of rule IDs (without the namespace) to rule definitions.
- `configs.strict`: a shared config that enables all rules at error severity.

The rule IDs as consumed by ESLint are:

- `@deities/no-copy-expression`
- `@deities/no-date-now`
- `@deities/no-inline-css`
- `@deities/no-lazy-import`

The root `eslint.config.js` imports this plugin and includes `deities.configs.strict`, so all rules run across the monorepo by default.

## Rule behavior and data flow

Each rule follows standard ESLint patterns: `create(context)` returns a set of AST node visitors; each visitor inspects the current node and either does nothing or calls `context.report(...)`. The rules are intentionally minimal and rely on ESTree node shapes produced by ESLint's parser.

### `no-copy-expression`

Intent: `.copy(...)` is treated as a pure/immutable operation in this codebase, so calling it without using its return value is almost always a bug.

AST pattern:

- Node type: `CallExpression`
- `node.callee.type === 'MemberExpression'`
- `node.callee.property.type === 'Identifier'`
- `node.callee.property.name === 'copy'`
- `node.parent.type === 'ExpressionStatement'` (the call is a standalone statement)

Behavior:

- Reports an error with the message: "'copy' calls are side-effect free. Did you forgot to assign the result of this call?"
- No auto-fix and no suggestions.

Design consequence:

- This enforces immutable data flow patterns in `athena/`, `apollo/`, `hera/`, etc., where `.copy()` is used pervasively on map, unit, and config objects.

### `no-date-now`

Intent: Centralize time access to allow server/client time sync and deterministic behavior.

AST pattern:

- Node type: `CallExpression`
- `node.callee.type === 'MemberExpression'`
- `node.callee.object.name === 'Date'`
- `node.callee.property.name === 'now'`

Behavior:

- Reports an error: "Use 'dateNow()' instead of 'Date.now()'."
- Auto-fixes by replacing the exact source text with `dateNow()`.

Design consequence:

- Time is mediated through `@deities/apollo/lib/dateNow.tsx`, which applies a server-provided offset (`setTime`) and is the canonical time source across packages.
- The rule does not add imports; it assumes `dateNow()` is already in scope (or that the developer will import it). In this repo, the canonical implementation lives in `apollo/`.

### `no-inline-css`

Intent: Ensure CSS-in-JS definitions are static and module-scoped. This avoids recreating style objects on every render and keeps styles discoverable and cacheable.

AST pattern (simplified):

- Node type: `TaggedTemplateExpression`
- `node.tag.type === 'Identifier'`
- `node.tag.name === 'css'`
- The tagged template (or a small set of parent wrappers) is *not* rooted at a `Program` node within 2–3 parent hops.

Behavior:

- Reports: "`css` template literals can only be used at the module top-level."
- No auto-fix and no suggestions.

Scope detection details:

- The rule treats a few wrappers as acceptable at the top level, such as:
  - `export const style = css\`\``
  - `const style = () => css\`\`` (arrow function body at top-level)
  - `const style = { foo: css\`\` }` (object literal at top-level)
- Any `css\`\`` created inside functions, callbacks, hooks, or nested objects will be flagged.

Design consequence:

- Encourages static `css` definitions in `ui/` and `hera/`, making styling patterns consistent and easier to optimize.

### `no-lazy-import`

Intent: Centralize React lazy-loading through a custom wrapper that handles runtime import failures.

AST pattern:

- Node type: `ImportDeclaration`
- `node.source.value === 'react'`
- One of the import specifiers is `import { lazy } from 'react'`

Behavior:

- Reports: "Importing 'lazy' from 'react' is forbidden. Use '@deities/ui/lib/lazy.tsx' instead."
- No auto-fix and no suggestions.

Design consequence:

- Forces code to use `@deities/ui/lib/lazy.tsx`, which wraps `React.lazy` and provides error handling and reload logic (e.g., handling chunk load failures with a UI fallback).

## Interactions with other packages

- `eslint.config.js` (repo root) imports `@deities/eslint-plugin` and applies `deities.configs.strict`, making these rules global across the workspace.
- `apollo/lib/dateNow.tsx` provides `dateNow()` and `setTime(...)`. The lint rule enforces that all time reads go through this API for consistency and determinism.
- `ui/lib/lazy.tsx` provides a custom lazy loader that wraps `React.lazy` with error handling and UI fallback. The lint rule bans direct `react` lazy imports to ensure use of this wrapper.
- The `css` tag that is enforced by `no-inline-css` is used with Emotion (`@emotion/css`) in UI layers; the rule keeps style definitions static and top-level for performance and clarity.
- The `.copy()` pattern used throughout `athena/`, `apollo/`, and `hera/` is part of the immutable data model; `no-copy-expression` guards against accidental discard of immutable updates.

## Portability notes (if recreating in another language or project)

To recreate this package in another language or for another game:

- Implement a lint plugin interface that can:
  - Walk the AST (ESTree-equivalent).
  - Match node patterns for `CallExpression`, `ImportDeclaration`, and `TaggedTemplateExpression`.
  - Report diagnostics with optional auto-fix text replacements.
- Replicate the rule semantics, especially:
  - The notion of `copy()` as a pure immutable update.
  - A centralized time API (equivalent of `dateNow`) with a way to update server time offsets.
  - Enforcing top-level-only CSS definitions if CSS-in-JS is used.
  - A project-specific lazy-loading wrapper with error handling, and a rule that enforces its usage.

The overall architecture is intentionally small: a single plugin entry point that exports a handful of focused rules and a strict config enabling them everywhere.
