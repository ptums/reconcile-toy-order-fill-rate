# Process: how the lessons work

Read this file first in a new session. Then read `REQUIREMENTS.md` (what we build, and where we stopped), `LEARNINGS.md` (Peter's questions) and `SELF_LEARNING.md` (how Claude must improve).

Linear ticket: TWS-77. Written in ASD-STE100 style.

## Roles

- **Peter** types each change, runs it, and tests it on the running server.
- **Claude** gives one piece at a time, explains why each piece is necessary, and checks Peter's work.
- Claude does not write the code for Peter, unless Peter asks for it ("can you make the change").

## One piece at a time

1. Claude gives **one piece**: at most 3 steps, with the exact code and the exact commands.
2. Each piece starts with what it does and why. Each piece ends with one test that Peter runs, and Claude asks for the output.
3. Peter implements it and pastes the result.
4. Claude checks the result **on disk and on the server** (see "How Claude checks"). Then Claude gives the next piece.
5. Before a piece with a design choice, Claude asks one question first, and Peter answers it.
6. Commands only. Do not give Peter shell scripts to run. Peter types each command.

## Questions

- When Peter asks a question, Claude answers it and adds it to `LEARNINGS.md` as `### Qn.`, with the part and piece number, the answer and an interview answer.
- System design ideas are the main focus. Name them when they come up (pagination, rate limiting, idempotency, N+1, indexes, and so on).

## How Claude checks

1. Read the file on disk (for example `sed -n` or Read). Peter's editor sometimes does not save, so do not trust "done".
2. Run `pnpm exec tsc`. No output means no type errors.
3. Send the test request with `curl` to the running server (Peter runs `pnpm dev:mock` in his own terminal).
4. Never start a second server on Peter's ports (8001). If Claude must start a server, use another port and stop it, then check with `lsof -nP -iTCP:<port> -sTCP:LISTEN`.

## Language and stack

- TypeScript only, on Node 22, with ESM (`"type": "module"`). No Python.
- Run with `tsx` (no build step). Check types with `tsc` (`noEmit`).
- Package manager: pnpm.
- When an idea is new, compare it with something Peter knows from TypeScript or Node.

## Git

- Commit and push only when Peter says "commit; push".
- Do not change `legacy/` (the 2021 code) or `fixtures/` (the anonymized sample report).

## AWS (part 4)

- AWS CLI only: no console clicks, no CDK, no CloudFormation, unless Peter asks.
- Give the commands one at a time, as above. Do not give Peter scripts.
- Profile `reconciler`, Region `us-east-2`. Sign in with `aws login --region us-east-2 --profile reconciler`. The credentials last 12 hours.
- The project uses the new AWS experience, Free plan, with $100 credits until 2027-04-19. `CLAUDE.md` holds the AWS Agent Toolkit rules, with help level HIGH.
- Cost cap: **$5 a month**. The budget `monthly-5-usd` exists (alerts at 80% actual and 100% forecast, credits not counted). Do not use EKS, NAT gateways, RDS or load balancers. Prefer Lambda, SQS, DynamoDB on-demand and S3.
- The AWS MCP server and the AWS skills are installed. Load the matching AWS skill before AWS work.

## Response format

- ASD-STE100: short sentences, active voice, simple words, numbered steps.
- Keep each reply short. Code goes in code blocks.
