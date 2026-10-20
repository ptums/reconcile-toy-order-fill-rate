# Self-learning: how Claude can improve these lessons

Mistakes Claude made in this project, and the rule that prevents each one. Read before each session. Written in ASD-STE100 style.

## Rules

1. **Check the file on disk before you say "it works".** Peter said "done" two times, but his editor had not saved the file. Read the file, run `tsc`, and send `curl` before the next piece. (2026-10-18)
2. **Test each snippet before you give it.** The first `orders` resolver gave an empty list when the client sent no `query`. Real Shopify returns the first orders. Peter found the bug, not Claude. Run each snippet in a scratch copy, and test the edge cases (no argument, not found, many results). (2026-10-18)
3. **Give a complete `tsconfig.json` the first time.** It needed `skipLibCheck` and `include`, so `tsc` reported errors in `node_modules` and `tools/`. (2026-10-18)
4. **Stop every process you start.** A test run left two servers on ports 8001 and 8002, and Peter got `EADDRINUSE`. `pkill` on the watcher did not stop its child process. Use a different port for your own tests, and check with `lsof` after you stop them. (2026-10-18)
5. **Do not give Peter scripts.** Peter wants one command at a time, so he sees each step. Scripts hide the steps. (2026-10-18)
6. **Ask before a big change of direction.** The Python version and the first TypeScript version were both thrown away. Before you build a lot, confirm the language, the stack and the order of the parts with Peter. (2026-10-18)
7. **Keep pieces small.** A piece has at most 3 steps. If a piece needs more, split it.
8. **Do not repeat what Peter already knows.** TypeScript and the frontend are known skills. Explain the system design idea, not the syntax.
9. **Document each question.** Every question from Peter goes into `LEARNINGS.md` at once, not at the end of the session.
10. **Give a refactor as whole files or exact before/after blocks.** Piece 9a (move the code into `createApp()`) packed 4 edits into one bullet, with no line numbers. Peter pasted the steps into the file, and the edits got mixed up. For a move or a wrap, give the full new file, or one before/after block for each edit. (2026-10-19)

## Ideas to try

- Give a "check" command with each piece (for example the exact `curl`), so Peter tests the same way that Claude checks.
- At the end of each part, give a short summary of the system design ideas in that part, with interview answers.
- When `REQUIREMENTS.md` changes ("Where we stopped"), update it in the same commit as the code.
