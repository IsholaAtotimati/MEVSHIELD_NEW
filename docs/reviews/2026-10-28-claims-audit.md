# Claims audit, 28 October 2026

Read-only audit of factual claims made about this repository and about the deployed Sepolia router, by the project owner and by earlier agents. Branch `feature/web-app-redesign` at `a0120d96`. Every repository claim below was checked against that commit with `git show <rev>:<path>`, not against the working tree, because the working tree was being edited concurrently while this audit ran. On `feature/sepolia-fork-demo` that same tree is `4a20bf02`, after the commit subjects were reworded. The files the commands read are unchanged. `feature/web-app-redesign` itself was not moved, so `a0120d96` is still that branch's commit.

Nothing in `src/`, `test/`, `frontend/`, `backend/` or `foundry.toml` was modified. The only file written is this one.

Verdict key:

- TRUE means the claim reproduces exactly with the command shown.
- FALSE means the claim is contradicted by a command whose output is shown. It does not mean the author lied; several false claims were true when written and went stale, and two are labelling errors.
- UNPROVEN means no command available to this audit can settle it. Each such case names what is missing.

Verdict counts across the 69 claims adjudicated here: 55 TRUE, 12 FALSE, 2 UNPROVEN.

## Summary table

### A. Sources: `docs/eae/2026-10-28-router-getters-and-bytecode.md`

| Id | Claim | Verdict | Evidence pointer |
|---|---|---|---|
| A1 | `protectedPoolId()` and `protectedHook()` revert on the deployed router | TRUE | `cast call` returns execution reverted for both |
| A2 | The two getters are declared in project source | FALSE | `git grep` finds them in no `src/` file at any ref |
| A3 | No committed version ever contained the getters | TRUE | `git log --all -S protectedPoolId -- src/` is empty |
| A4 | `poolManager` is the router's only public state getter | TRUE | line 43 is the only public state variable; line 60 is a constant |
| A5 | Deployed runtime bytecode length differs from the local artifact | FALSE | deployed 5667 bytes, local artifact 5667 bytes |
| A6 | The router was deployed from an uncommitted tree | TRUE | deployed runtime matches `ae3cc4f`, committed 30 min after the deploy |
| A7 | Broadcast records tx, block 11969313, PoolManager argument | TRUE | `run-latest.json` plus on chain `poolManager()` |
| A8 | Broadcast timestamp is 22 October 2026, 11:42 UTC | TRUE | `timestamp` decodes to 11:42:22 UTC |
| A9 | Router source changed afterwards in `ae3cc4f` (22 October) | TRUE | `git log` on the router file |
| A10 | `foundry.toml` uses `via_ir = true` and `optimizer_runs = 1` | TRUE | `git show 8a676f6:foundry.toml` |
| A11 | The frontend and scripts call the two getters | FALSE | `git grep` across `frontend/ backend/ script/ src/ test/` is empty |
| A12 | Lukman reported the getters reverting | UNPROVEN | No artefact of his report exists in the repo |
| A13 | The getters exist only in Lukman's uncommitted source | UNPROVEN | No WIP branch, no remote branch, no local copy |
| A14 | Foundry is not installed on Tonye's machine | FALSE | `forge` and `cast` 1.8.6 resolve in `~/.foundry/bin` |

### B. Sources: `docs/reviews/2026-10-28-router-bytecode-investigation.md` and `docs/reviews/router-bytecode-comparison.json`

| Id | Claim | Verdict | Evidence pointer |
|---|---|---|---|
| B1 | Selector `protectedPoolId()` is `0xf976fd28` and absent | TRUE | zero occurrences in the fetched runtime |
| B2 | Selector `protectedHook()` is `0x3ff8d5e4` and absent | TRUE | zero occurrences in the fetched runtime |
| B3 | Selector `poolManager()` is `0xdc4c90d3` and present | TRUE | one occurrence |
| B4 | `poolManager()` returns `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | TRUE | `cast call` output |
| B5 | Deployed runtime is 5667 bytes | TRUE | 11334 hex characters after the `0x` prefix |
| B6 | The committed hex artifact equals the live runtime | TRUE | `diff` of a fresh `cast code` against the committed file |
| B7 | Normalized runtime matches the `HEAD` build | TRUE | independent mask and strip, `code(masked) equal: true` |
| B8 | Normalized runtime matches the `ae3cc4f` build | TRUE | same script, same result |
| B9 | Normalized runtime does not match the `027c927` build | TRUE | 3029 against 5667 bytes, first difference at byte 45 |
| B10 | The broadcast commit is stale relative to the deployed bytecode | TRUE | broadcast says `027c927`, bytecode matches a later tree |
| B11 | Table column "Router source size (bytes)" holding 5667 and 3029 | FALSE | those are runtime bytecode lengths; sources are 9606 and 5876 bytes |
| B12 | The comparison table's `HEAD` row is commit `319e240` | FALSE | `319e240` is not an ancestor of the branch that carries the document |
| B13 | The reported length mismatch was probably an unmasked comparison | FALSE | masking the CBOR tail and immutables never changes length |
| B14 | Toolchain was Forge 1.8.6 with solc 0.8.26 and EVM cancun | TRUE | artifact metadata and `forge --version` |
| B15 | Lukman's WIP branch was not available | TRUE | no local or remote branch of that name |
| B16 | The getters were never part of the deployed or committed router ABI | TRUE | all four ABI selectors are present on chain, no extras |

### C. Sources: `docs/reviews/2026-10-28-code-review.md`, original findings and closure section

| Id | Claim | Verdict | Evidence pointer |
|---|---|---|---|
| C1 | Finding 7 CLOSED, compiler pinned to 0.8.26 and cancun on both branches | TRUE | both `foundry.toml` blobs identical |
| C2 | Finding 10 CLOSED, every numeric field has a 78 digit bound | FALSE | `minAmountOut` accepts 100 digits |
| C3 | Finding 10 CLOSED, Zod failures map to 400 and the 500 body is stable | TRUE | `server.ts:286` to `290` and `:293` to `296` |
| C4 | Finding 11 CLOSED, risk level is only `LOW` | TRUE | `riskEngine.ts:11` and `:47` |
| C5 | Finding 12 CLOSED, `App.tsx` is 30 lines with `strict` on | TRUE | `wc -l` and `tsconfig.app.json:24` |
| C6 | Finding 13 CLOSED, Trade is "one primary button" | FALSE | two `class="primary"` buttons at `TradePage.tsx:206` and `:234` |
| C7 | Finding 14 CLOSED, CI has frontend and backend jobs | TRUE | both jobs present, each running install, test, build |
| C8 | Finding 15 CLOSED, `backend/dist` untracked and ignored | TRUE | 0 tracked files, `.gitignore:5`, `tsconfig` excludes |
| C9 | Finding 17 PARTIAL, route tests cover the demo minimum rule | FALSE | no test sets `localDemoMode: true` |
| C10 | Finding 17 PARTIAL, `server.test.ts` imports `createApp`, `generatePolicy` untested | TRUE | import at line 17, no direct test |
| C11 | Finding 3 PARTIAL, key read inside `if (requireSigner)`, no caller auth or rate limit | TRUE | `runtimeConfig.ts:191` and `:192`, only `cors` at `server.ts:85` |
| C12 | Finding 9 PARTIAL, schema accepts any positive minimum, server rejects `1` off demo | TRUE | schema run accepts `2`, `server.ts:162` |
| C13 | Finding 19 CLOSED, `VITE_API_URL` is localhost in the example | TRUE | `.env.example` matches `config/env.ts` default |
| C14 | Finding 20 CLOSED, freshness derived from a ticking clock, restore path gone | TRUE | `useProtectedQuote.ts:127`, restore only in the unused backup |
| C15 | Finding 16 OPEN, four hand copied `Policy` structs, Week 3 header, unused errors | TRUE | lines cited exist as described |
| C16 | Finding 18 OPEN, three hand written EIP-712 field lists | TRUE | `policySigner.ts:9`, `testSigner.ts:72`, `verifyApiSignature.ts:24` |
| C17 | Finding 21 OPEN, no `LICENSE`, tracked leftovers | TRUE | no root `LICENSE`, five tracked artefacts |
| C18 | Finding 22 OPEN, `docs/*` ignored, one assignment tracked | TRUE | `.gitignore:14`, tracked assignment file |
| C19 | Finding 1 OPEN, caps compared to `hookData` estimates | TRUE | `MEVShieldHook.sol:114` |
| C20 | Finding 2 OPEN, minimum output and tick cap only on the router | TRUE | `MEVShieldRouter.sol:154` and `:149` |
| C21 | Findings 4, 5, 6, 8 OPEN as described | TRUE | line references in `hook`, `registry` and `test/` all resolve |
| C22 | Original review: `App.tsx` 1758 lines, `strict` off, at `8a676f6` | TRUE | 1758 lines, no `strict` key |
| C23 | Original review: `FOUNDRY_PROFILE: ci` with no `[profile.ci]` | TRUE | workflow line 11 at `8a676f6`, no such profile |
| C24 | Original review: `backend/dist` had 23 committed files | TRUE | 23 tracked paths at `8a676f6` |
| C25 | Original review: about 100 Forge tests in 10 files | TRUE | exactly 100 `function test_` across 10 files |
| C26 | Original review: 36 `node:test` cases | TRUE | 36 top level `test(` calls at `8a676f6` |
| C27 | Fork: deployment verification passes and the pool is liquid | TRUE | suite passes, pool `0x9275...b602`, active liquidity 1541399567004 |
| C28 | Fork: all three V2 router minimum output cases pass | TRUE | 3 passed with `RUN_SEPOLIA_FORK_V2=true` |
| C29 | Fork: `SepoliaForkV2Router` deploys its own router and etches the hook | TRUE | `new MEVShieldRouter` at line 79, `vm.etch` at line 86 |
| C30 | Fork: the execution suite is blocked in `setUp` on `SIGNER_PRIVATE_KEY` | TRUE | reproduced, `vm.envUint` failure at line 97 |
| C31 | Router outcome: getters never existed, selectors absent, calls revert | TRUE | same evidence as A1, A3 and B1 to B3 |
| C32 | Router outcome: frontend and backend addresses match the live deployment | TRUE | all five addresses return non empty code |

### D. Source: `README.md`

| Id | Claim | Verdict | Evidence pointer |
|---|---|---|---|
| D1 | The tick distance is configurable | FALSE | `uint24 public constant MAX_PRICE_LIMIT_TICK_DISTANCE = 600` |
| D2 | Risk categories use `lossBps` thresholds for LOW, MEDIUM and HIGH | FALSE | engine returns only `LOW`, `lossBps` was removed in `319e240b` |
| D3 | The router checks output against the policy minimum | TRUE | `MEVShieldRouter.sol:161` to `:179` |
| D4 | README does not claim realized loss or fee enforcement | TRUE | line 607 states caps compare to caller-supplied estimates |
| D5 | README does not claim deployment verification is complete | TRUE | line 507 is a checklist, roadmap box at line 622 unticked |
| D6 | Roadmap box "minimum-output enforcement to the current router source" | TRUE | scoped to the router, which is what runs |
| D7 | "on-chain enforcement" as a top level description | TRUE | accurate given the boundary statement at line 607 |

## False and unproven claims in detail

### A2. "The getters are declared in source"

Claimed: `protectedPoolId()` and `protectedHook()` revert on the deployed router "although they are declared in source".

Actually true: no committed source at any ref declares either function.

```
$ git grep -n "protectedPoolId\|protectedHook" a0120d96 -- src/
(no output)
$ git grep -n "protectedPoolId\|protectedHook" 8a676f6 -- src/
(no output)
$ git grep -n "protectedPoolId\|protectedHook" ae3cc4f -- src/
(no output)
$ git grep -n "protectedPoolId\|protectedHook" 027c927 -- src/
(no output)
$ git log --all --oneline -S "protectedPoolId" -- src/
(no output)
$ git log --all --oneline -S "protectedHook" -- src/
(no output)
```

A sweep of all 40 commits in `git rev-list --all` also found neither symbol in `src/`. The only files in the whole repository that contain those strings are the two review documents written on 28 October.

Practical consequence: do not add getters to "restore" a symbol that a caller expects. There is no committed caller and no committed declaration, so adding them would be new API surface, not a repair. If the product wants them, add them with tests and redeploy; the current on chain router will not gain them.

### A5. "The deployed runtime bytecode length differs from the local artifact"

Claimed: the deployed runtime length differs from the locally compiled artifact.

Actually true: the deployed runtime is 5667 bytes and the artifact built from this tree is 5667 bytes. The raw bytes differ in the metadata tail and the immutable slot, but the length is the same.

```
$ cast code 0x633282608B2fc66cD7572f5eF58e804063aa150D --rpc-url $RPC > /tmp/deployed-6332.hex
$ HEX=$(tr -d '\n' < /tmp/deployed-6332.hex); echo $(( (${#HEX} - 2) / 2 ))
5667
$ forge build --skip test --skip script
$ node -e 'const a=require("./out/MEVShieldRouter.sol/MEVShieldRouter.json");
  console.log(a.deployedBytecode.object.replace(/^0x/,"").length/2)'
5667
```

Length is a weak discriminator in general, but under this project's own profile it is stable. The table below varies one build setting at a time from the commit `8a676f6`:

| Build variation | Runtime length |
|---|---|
| default profile, solc 0.8.26, cancun | 5667 |
| `--use 0.8.28` | 5667 |
| `--use 0.8.30` | 5667 |
| `--optimizer-runs 200` | 5708 |
| `FOUNDRY_VIA_IR=false` | 7456 |

So a length mismatch is reproducible only by building with different settings, and no such settings produce the deployed length except the project's own profile. The claim as a statement about this repository is contradicted.

Practical consequence: stop using length as the test. The useful comparison is the normalized bytecode, which is already scripted. A length only comparison will either pass (as here) or produce a misleading failure, and it cannot distinguish a metadata change from a logic change.

### A11. "The frontend and scripts call the two getters"

Claimed, as part of the closing sentence of the brief: "the committed source, the deployed bytecode and the frontend calls do not describe the same contract".

Actually true: nothing in this repository calls either getter.

```
$ git grep -n "protectedPoolId\|protectedHook" a0120d96 -- frontend/ backend/ script/ src/ test/
(no output)
$ git grep -n "protectedPoolId\|protectedHook" a0120d96 -- frontend/src/lib/abis.ts
(no output)
$ git grep -n "poolManager" a0120d96 -- frontend/src/lib/abis.ts
a0120d96:frontend/src/lib/abis.ts:204:    name: "poolManager",
```

Practical consequence: the recommended step "remove or guard all off repo callers of the two getters" has no work in this repository. If a caller exists, it is in a branch or a script that is not here, so the team should not budget for removing frontend code. This also means the mismatch story cannot be explained by a frontend that was written against a different router ABI; the frontend only reads `poolManager()`.

### A14. "Foundry is not installed on Tonye's machine"

Claimed: "Foundry is required (`forge`, `cast`); it is not installed on Tonye's machine yet, so install it with `foundryup` if missing."

Actually true at audit time: both binaries resolve and run.

```
$ export PATH="$HOME/.foundry/bin:$PATH"; cast --version; forge --version
cast Version: 1.8.6
forge Version: 1.8.6
```

Practical consequence: the install step in the brief is obsolete. It was probably accurate on the day it was written, and it matters only because it changes the expected first step for anyone following the brief.

### B11 and B12. Two labelling errors in the comparison table

Claimed: a column headed "Router source size (bytes)" holding 5667 for `HEAD` and `ae3cc4f` and 3029 for `027c927`, and a row labelled "`HEAD` (`319e240`)".

Actually true: those numbers are runtime bytecode lengths, not source sizes, and `319e240` is not the `HEAD` of the branch that carries the document.

```
$ for r in 027c927 ae3cc4f 8a676f6 a0120d96; do
    printf "%s %s bytes %s lines\n" "$r" \
      "$(git cat-file -s ${r}:src/MEVShieldRouter.sol)" \
      "$(git cat-file -p ${r}:src/MEVShieldRouter.sol | wc -l)"; done
027c927 5876 bytes 223 lines
ae3cc4f 9606 bytes 269 lines
8a676f6 9606 bytes 269 lines
a0120d96 9606 bytes 269 lines

$ git rev-list --parents -n 1 2f1080eb
2f1080ebbda0f667c030efc3bf9e9a883ed94088 34c65cd82c1aab3c4e7b0b7f2f41cc5db18cbf03
$ git merge-base --is-ancestor 319e240 2f1080eb && echo YES || echo NO
NO
$ git branch -a --contains 319e240
  docs/project-docs
  feature/local-docker
  feature/web-app-redesign
```

So the document on `fix/router-source-of-truth` labels a commit from a different branch as `HEAD`. The underlying result still holds, because the router blob is identical at `319e240`, `ae3cc4f`, `8a676f6` and `a0120d96`:

```
$ git rev-parse ae3cc4f:src/MEVShieldRouter.sol 8a676f6:src/MEVShieldRouter.sol a0120d96:src/MEVShieldRouter.sol
137c23b53b4077843f74fe32bffc8544056bfd52
137c23b53b4077843f74fe32bffc8544056bfd52
137c23b53b4077843f74fe32bffc8544056bfd52
```

Practical consequence: do not cite 5667 or 3029 as source sizes in a report, and do not treat `319e240` as a reference to the router branch. Anyone re running the comparison should build `ae3cc4f`, `8a676f6` and the branch tip; all three produce the same normalized runtime today.

### B13. "The length mismatch was probably an unmasked comparison"

Claimed: "Lukman's reported length mismatch was likely an unmasked comparison (CBOR tail and/or immutable slots) or a different artifact."

Actually true: neither masking immutables nor stripping the CBOR metadata tail can change a reported length. Stripping removes a tail from the copy that is compared, and masking overwrites bytes in place, but the two lengths the script reports (`localByteLen` and `deployedByteLen`) are measured from the unstripped values before either operation runs. A length only check would therefore have compared 5667 with 5667 and reported agreement, which is what this audit measured.

```
$ node /tmp/indep-compare.mjs
deployed total bytes: 5667 code bytes: 5614 meta bytes: 53
HEAD: total 5667 code 5614 meta 53
  code(masked) equal: true
ae3cc4f: total 5667 code 5614 meta 53
  code(masked) equal: true
027c927: total 3029 code 2976 meta 53
  code(masked) equal: false
```

The only mechanisms that change this length are a different source or a different build profile, as the table under A5 shows. Since the deployed runtime matches the committed source, his reported mismatch most plausibly came from a tree that did contain extra code, which is consistent with A13 being about his disk rather than this repository.

Practical consequence: the first of the two explanations the investigation offers is impossible, so if Lukman still reports a length mismatch the only remaining candidates are that he built a different source, a different profile, or a different compiler release. The right question is which of those, not whether he masked immutables. The existing comparison script already answers it: it builds each candidate tree and compares normalized runtime.

### C2. "Every numeric field has a 78 digit bound"

Claimed in the closure note for finding 10: `policyRequest.ts` "now validates every numeric field with a decimal pattern, a 78 digit bound, a non-zero nonce, a future expiry inside the 30 minute TTL, and a `sqrtPriceLimitX96` strictly between the v4 price bounds".

Actually true: every numeric field except `minAmountOut` has the 78 digit bound. `minAmountOut` uses a different pattern with no upper bound.

```
$ git show a0120d96:backend/src/policy/policyRequest.ts | sed -n '9,22p'
const decimalIntPattern = /^-?\d{1,78}$/;
const unsignedDecimalPattern = /^\d{1,78}$/;
const nonZeroUintPattern = /^[1-9]\d{0,77}$/;
...
    minAmountOut: z.string().regex(/^[1-9]\d*$/),
```

Executed against the real schema at `a0120d96`:

```
$ node --experimental-strip-types /tmp/pa/t2.mjs
minAmountOut=2 (any positive) -> ACCEPTED
minAmountOut=1 -> ACCEPTED
minAmountOut=0 -> REJECTED
minAmountOut=99999999999999999999 -> ACCEPTED
minAmountOut with leading zeros -> REJECTED
nonce=0 -> REJECTED
expiry far future -> REJECTED
extra field -> REJECTED

$ node --experimental-strip-types /tmp/pa/t3.mjs
minAmountOut 100 digits -> ACCEPTED
amountSpecified 100 digits -> REJECTED
expiry 79 digits -> REJECTED
```

Practical consequence: finding 10 is closed for four fields but not for `minAmountOut`, which is the field the closure note for finding 9 says is still unconstrained. The two closure entries contradict each other. Either annotate 10 as closed except `minAmountOut`, or bound the field. A 100 digit minimum is accepted by the schema and then signed, which is a policy the router will simply fail to satisfy, so the practical risk is a stuck policy rather than a bypass.

### C6. "Trade is one primary button"

Claimed in the closure note for finding 13: "Trade is now one primary button that goes check, then sign, then execute, instead of two independent controls with separate readiness rules".

Actually true: there are two buttons carrying the `primary` class on the Trade page. The second one, the execute button, is rendered after a policy is registered.

```
$ git show a0120d96:frontend/src/pages/TradePage.tsx | rg -n 'className="primary'
206:          className="primary primary-flow"
234:            className="primary execute-button"
```

The substantive part of the finding, that both controls now share one readiness rule, holds: the second button is disabled on `!swapReadiness.canExecute` at `TradePage.tsx:236`, the same predicate the first button uses.

Practical consequence: describe the change as "one readiness rule and a staged flow", not "one button". A reviewer who opens the page will see two primary styled buttons and conclude the closure note is wrong about the thing they can see, which costs trust in the rest of the note.

### C9. "Route tests cover the demo minimum rule"

Claimed in the closure note for finding 17: `server.test.ts` covers "the demo minimum rule".

Actually true: the file tests the rejection of `minAmountOut === "1"` when local demo is off, but no test ever sets `localDemoMode: true`, so the branch at `server.ts:154` that requires exactly `1` in demo mode is never executed.

```
$ git show a0120d96:backend/src/server.test.ts | rg -n "localDemoMode"
44:    localDemoMode: false,
59:    localDemoMode: false,
130:    createApp(baseDeps({ policySigningEnabled: false, localDemoMode: false })),
$ git show a0120d96:backend/src/server.test.ts | rg -n "localDemoMode: true" || echo NONE
NONE
$ git show a0120d96:backend/src/server.test.ts | rg -n "^test\("
96:test("GET /health exposes monitor last checked block", async () => {
109:test("POST /risk-preview returns deterministic MVP metadata", async () => {
121:test("POST /policy returns 503 when signing is disabled", async () => {
128:test("POST /policy returns 503 when signing is disabled regardless of request body", async () => {
140:test("POST /policy rejects invalid JSON with 400", async () => {
169:test("POST /policy validates request bodies before signing", async () => {
186:test("POST /policy rejects minAmountOut of 1 when signing enabled without local demo", async () => {
198:test("POST /policy rejects out-of-range sqrt price before signing", async () => {
```

The suite does run and pass, 8 tests here and 68 across the backend at `a0120d96`:

```
$ cd backend && npm test
ℹ tests 68
ℹ pass 68
ℹ fail 0
```

Practical consequence: the demo path is the one used for the Monday demo, and its guard is untested. Add a case with `localDemoMode: true` asserting 400 on `minAmountOut: "2"` and, ideally, a pass through to signing with `"1"`. Until then finding 17 is less closed than the note says.

### D1. "The tick distance is configurable"

Claimed in `README.md` line 93: the router "enforces a configurable maximum distance between the current tick and the requested price-limit tick".

Actually true: the distance is a hard coded constant, not a constructor argument and not settable.

```
$ git show a0120d96:src/MEVShieldRouter.sol | rg -n "MAX_PRICE_LIMIT_TICK_DISTANCE|constructor|immutable|constant"
43:    IPoolManager public immutable poolManager;
60:    uint24 public constant MAX_PRICE_LIMIT_TICK_DISTANCE = 600;
62:    constructor(IPoolManager poolManager_) {
149:        if (uint256(distance) > MAX_PRICE_LIMIT_TICK_DISTANCE) {
150:            revert PriceLimitTooFar(currentTick, limitTick, MAX_PRICE_LIMIT_TICK_DISTANCE);
$ git show a0120d96:script/DeploySepolia.s.sol | rg -n "new MEVShieldRouter"
74:        info.router = address(new MEVShieldRouter(IPoolManager(info.manager)));
```

Practical consequence: nobody should plan work that "adjusts the cap by config". Changing 600 requires editing source, rebuilding and redeploying the router. The document should say fixed at 600 in this source, and that the value was chosen as roughly 6.2 percent per the comment at line 58.

### D2. The LOW, MEDIUM and HIGH threshold table

Claimed in `README.md` lines 292 to 300: the implementation "uses thresholds to assign a risk category" with LOW at `lossBps <= 10`, MEDIUM at `lossBps <= 50`, and HIGH above.

Actually true: the engine returns only `LOW` and `lossBps` no longer exists in the backend.

```
$ git show a0120d96:backend/src/risk/riskEngine.ts | rg -n "riskLevel|lossBps"
11:  riskLevel: "LOW";
47:    riskLevel: "LOW",
$ git show a0120d96:backend/src/risk/riskEngine.ts | rg -n "lossBps" || echo NO_LOSSBPS
NO_LOSSBPS
$ git show 319e240b -- backend/src/risk/riskEngine.ts | rg -n "^-.*lossBps|^-.*MEDIUM|^\+.*riskLevel"
-  riskLevel: "LOW" | "MEDIUM" | "HIGH";
-  const lossBps =
-  } else if (lossBps <= 50n) {
+    riskLevel: "LOW",
```

The README text was accurate at `8a676f6` and went stale when `319e240b` collapsed the level to `LOW`. The frontend still declares the wider union, so nothing breaks, but the document describes a model that does not run:

```
$ git show a0120d96:frontend/src/lib/types.ts | rg -n "riskLevel"
44:  riskLevel: "LOW" | "MEDIUM" | "HIGH";
```

Practical consequence: the README is the public description of the risk model, and it currently promises a three level classification. Either restore the thresholds or rewrite lines 292 to 300 to state that the current engine returns one level. Note also that the closure note for finding 11 correctly says the level is always `LOW`, so the repository now contains two documents that contradict each other about the same function.

### A12. UNPROVEN. That Lukman reported the reverting getters

Claimed in the brief: "The problem, as Lukman reported it", followed by the getters reverting and the bytecode length differing.

What would settle it: the message, ticket or call note in which he said it, or his own confirmation. The repository contains no such artefact, and the audit has no access to his messages.

What is settled independently: calls to both getters do revert on chain today (A1), so the observable half of the report is accurate regardless of who said it.

### A13. UNPROVEN. That the getters exist in Lukman's uncommitted working tree

Claimed: "The getters exist only in Lukman's local, uncommitted source."

What would settle it: his working tree, pushed as a branch, or a copy of his `MEVShieldRouter.sol`.

What the audit can see:

```
$ git branch -a | rg -i "wip|deployed-router"
(no output, other than fix/router-source-of-truth which is this investigation branch)
$ git ls-remote --heads origin
8a676f6ddde11ef2c5b2fc981afe5de4a9f2dae2	refs/heads/main
```

There is no WIP branch locally and the only remote branch is `main`. The hypothesis is consistent with A6, because the deployed runtime was built from source that was committed half an hour after the deploy, but consistency is not proof that the uncommitted tree contained the getters. The deployed ABI has exactly four selectors, all of which are in the committed source, so the deployed code did not contain the getters even if his local source did.

Practical consequence: this claim should not be repeated as fact in a status update. What can be said without qualification is that the deployed router has no such functions, that no committed version had them, and that the deploy came from a working tree whose source was committed later as `ae3cc4f`.

## What the audit confirms

Four results deserve to be stated positively, because they are the ones people will build on.

The on chain facts hold. The router at `0x633282608B2fc66cD7572f5eF58e804063aa150D` has 5667 bytes of runtime, exposes `poolManager()` returning `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` and `MAX_PRICE_LIMIT_TICK_DISTANCE()`, exposes `executeSwap` and `unlockCallback`, and has neither of the two getters. All four ABI selectors of the committed build are present on chain and there are no extras.

The bytecode comparison reproduces exactly. Independent of the committed script, a fresh fetch of the runtime, with the CBOR tail split out and the five `poolManager` immutable slots masked at the artifact's own offsets, is byte identical to the `HEAD`, `ae3cc4f` and `8a676f6` builds, and differs in length from the `027c927` build. The deployed code is committed source.

The deploy provenance claim is stronger than the investigation said. The deployment block timestamp is 2026-10-22 11:41:48 UTC and `ae3cc4f` was committed at 2026-10-22 12:12:07 UTC, 30 minutes later, while its build matches the deployed runtime. That is direct support for A6: the deploy was made from a working tree that was not yet committed. The broadcast's recorded commit, `027c927` from 5 October, describes the checkout HEAD, not the code that was deployed, which is exactly why B10 is correctly labelled stale.

The fork evidence holds up under rerun at the pinned block. `SepoliaForkDeploymentVerification.t.sol` passes and reports pool `0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602` with active liquidity. `SepoliaForkV2Router.t.sol` passes all three cases, including the exact boundary and the rollback. `SepoliaForkDeploymentAExecution.t.sol` fails in `setUp` on the missing `SIGNER_PRIVATE_KEY`, which is why the UI gate staying closed is correct.

## How to re-run this audit

On chain checks. Read only, no key, no transaction.

```bash
export PATH="$HOME/.foundry/bin:$PATH"
export RPC=https://ethereum-sepolia-rpc.publicnode.com

cast code 0x633282608B2fc66cD7572f5eF58e804063aa150D --rpc-url $RPC > /tmp/deployed.hex
HEX=$(tr -d '\n' < /tmp/deployed.hex); echo $(( (${#HEX} - 2) / 2 ))

cast sig "protectedPoolId()"    # 0xf976fd28
cast sig "protectedHook()"      # 0x3ff8d5e4
cast sig "poolManager()"        # 0xdc4c90d3
for s in f976fd28 3ff8d5e4 dc4c90d3; do
  grep -c "$s" /tmp/deployed.hex || true
done

cast call 0x633282608B2fc66cD7572f5eF58e804063aa150D "poolManager()(address)" --rpc-url $RPC
cast call 0x633282608B2fc66cD7572f5eF58e804063aa150D "protectedPoolId()(bytes32)" --rpc-url $RPC
cast call 0x633282608B2fc66cD7572f5eF58e804063aa150D "protectedHook()(address)" --rpc-url $RPC
cast block 11969313 --rpc-url $RPC timestamp
```

Bytecode comparison. Fetch artifacts for the three source states and compare.

```bash
git worktree add /tmp/wt-027c927 027c9279
git worktree add /tmp/wt-ae3cc4f ae3cc4f3
git worktree add /tmp/wt-head a0120d96
# each worktree needs lib/ populated, then:
(cd /tmp/wt-027c927 && forge build --skip test --skip script)
(cd /tmp/wt-ae3cc4f && forge build --skip test --skip script)
(cd /tmp/wt-head    && forge build --skip test --skip script)

node script/compare-router-bytecode.mjs /tmp/deployed.hex \
  /tmp/wt-head/out/MEVShieldRouter.sol/MEVShieldRouter.json \
  /tmp/wt-027c927/out/MEVShieldRouter.sol/MEVShieldRouter.json \
  /tmp/wt-ae3cc4f/out/MEVShieldRouter.sol/MEVShieldRouter.json
```

Expect 5667 for head and `ae3cc4f` with `normalizedMatch: true`, and 3029 for `027c927` with `normalizedMatch: false`.

Repository claims. Always read through the commit, because the working tree may be dirty.

```bash
git show a0120d96:frontend/src/App.tsx | wc -l                        # 30
git show a0120d96:frontend/tsconfig.app.json | rg -n '"strict"'       # line 24
git ls-tree -r --name-only a0120d96 backend/dist | wc -l              # 0
git ls-tree -r --name-only 8a676f6 backend/dist | wc -l               # 23
git show a0120d96:.gitignore | sed -n '5p;14p'
git show a0120d96:foundry.toml
git show a0120d96:backend/src/risk/riskEngine.ts | rg -n "riskLevel"
git show a0120d96:backend/src/policy/policyRequest.ts | sed -n '21p'
git show a0120d96:backend/src/server.ts | rg -n "policySigningEnabled\)|localDemoMode && input|!deps.localDemoMode"
git show a0120d96:backend/src/server.test.ts | rg -n "^test\(|localDemoMode"
git show a0120d96:src/MEVShieldRouter.sol | rg -n "MAX_PRICE_LIMIT_TICK_DISTANCE|constructor"
git show a0120d96:src/MEVShieldHook.sol | rg -n "estimatedLoss > policy.maxLoss|Week 3"
git grep -n "protectedPoolId\|protectedHook" a0120d96 -- src/ frontend/ backend/ script/ test/
git grep -nE "testFuzz_|invariant_" a0120d96 -- test/
diff <(git show a0120d96:foundry.toml) <(git show fix/router-source-of-truth:foundry.toml)
```

Schema behaviour. Copy the schema out and exercise it with the backend's own zod.

```bash
git show a0120d96:backend/src/policy/policyRequest.ts > /tmp/pa/policyRequest.ts
# point the import at backend/node_modules/zod, then:
node --experimental-strip-types /tmp/pa/t2.mjs
```

Backend suite.

```bash
cd backend && npm test     # 68 pass at a0120d96
```

Fork suites, read only, at the pinned block. Each suite has its own gate variable, and the V2 router suite uses `RUN_SEPOLIA_FORK_V2`, not a name of your own choosing.

```bash
RUN_SEPOLIA_FORK_DEPLOYMENT_VERIFICATION=true SEPOLIA_FORK_BLOCK_NUMBER=12011114 \
  forge test --match-path test/SepoliaForkDeploymentVerification.t.sol \
  --fork-url $RPC --fork-block-number 12011114 -vv

RUN_SEPOLIA_FORK_V2=true SEPOLIA_FORK_BLOCK_NUMBER=12011114 \
  forge test --match-path test/SepoliaForkV2Router.t.sol \
  --fork-url $RPC --fork-block-number 12011114 -vv

RUN_SEPOLIA_FORK_DEPLOYMENT_A_EXECUTION=true SEPOLIA_FORK_BLOCK_NUMBER=12011114 \
  forge test --match-path test/SepoliaForkDeploymentAExecution.t.sol \
  --fork-url $RPC --fork-block-number 12011114 -vv
```

The third command is expected to fail in `setUp` with `vm.envUint: environment variable "SIGNER_PRIVATE_KEY" not found`. That failure is the evidence for C30, so do not supply a key to make it pass.
