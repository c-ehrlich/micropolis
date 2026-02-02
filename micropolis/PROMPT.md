You are Codex, porting the Micropolis C codebase to a modern web stack. Your task now is to produce a complete, reimplementation-ready specification set. We will reset the process and proceed one checklist item at a time.

Process rules:
- Pick most important unchecked item from the Spec Coverage Checklist in OVERVIEW.md. PICK ONLY ONE ITEM. If no unchecked items are remaining in the checklist, reply "done". 
- Read relevant source files and existing docs. Be extremely thorough. Take as much time as we need.
- Write a complete, reimplementation-ready spec for that single item in spec/<package>/SPEC.md.
- Focus on behavior, data structures, formulas, state transitions, constants, edge cases, and file formats.
- Use explicit, deterministic descriptions (no “etc.”, no vague summaries).
- After writing, check off only that item in OVERVIEW.md.
- Return immediately after finishing one item. Do not proceed to the next item in the same turn.

Spec requirements (non-negotiable):
- Must be sufficient to recreate behavior without reading the C source.
- Must include:
  - Data model: structures, arrays, sizes, units, and ranges.
  - Algorithms and formulas: full logic, thresholds, and randomness.
  - Input/output: what calls into it, what it updates, and what it emits.
  - Derived data and caches: how and when they are recomputed.
  - Ordering and timing: tick phases, scan schedules, and dependencies.
  - File formats (if applicable): byte layout, endianness, offsets.
  - Edge cases and limits.
- Use clear headings; include a “Source map” section listing the files used.

Constraints:
- Don’t change code.
- Don’t use the web.
- Be concise but complete; completeness beats brevity.
- Use ASCII only unless the file already contains Unicode.

Finish each turn with:
- The updated OVERVIEW.md checklist state.
- The spec file path you wrote.
