- make sure to run `pnpm typecheck`, `pnpm lint`, and `pnpm format` when you're done. don't run them after every single step, just before you cede control back to me. you may skip this if there have not been any code changes.
- if i asked you to make some changes, and you had already opened a PR, push these changes to the PR and again give me a link to visit the pr on github.
- reminder that the code we're porting from is in C, so some aspects of math will be different (for example division of two integers), be sure to reference source files where necessary to check what the original behaviour is and implement something that will behave the same in typescript
- if you get type errors related to undefined / unchecked index, look at the `assertDefined` function
- if your environment doesn't have the network access for `pnpm install`, run `pnpm install --offline` and tell me if that fails also, in that case i'll install it manually. give me the commands. it's usually something like:
  - `cd /Users/cje/dev/city/.worktrees/mapscan`
  - `CI=true pnpm install --store-dir /Users/cje/dev/city/.pnpm-store/v10`
- when creating new functionality, make sure every function, class, etc. has jsdoc explaining which part of the c codebase in `ref/micropolis` it relates to. say if it's a 1:1 port or what is different.
  - if you read an existing function that doesn't have this, and are confused by what it does, use a subagent to research this, and add/update the jsdoc string
  - example docstring:
  ```ts
  /**
  * Road eligibility check for the full traffic simulation.
  * Mirrors `RoadTest` in `ref/micropolis/src/sim/s_traf.c`.
  */
  ```
- when writing tests, if you assert that some function called with some arguments returns some number, or something like that, document where in the micropolis c codebase these "magic" numbers are coming from
- put test files next to the file that they're testing, if they are testing primarily functionality from one file. if the file is named foo.ts, name the test foo.test.ts.
