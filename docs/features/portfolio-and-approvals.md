# Portfolio and approvals

**Status: shipped.** Balances, wrap and unwrap, and exact-amount router allowances all work against Sepolia.

The Portfolio page covers the token handling that a protected swap needs before and after execution: it shows what the user holds, converts native ETH to the WETH the pool actually trades, and manages the router allowance that `executeSwap` depends on.

## What it does

### Balances

Three reads on mount and on demand: native ETH balance, WETH balance, USDC balance ([frontend/src/pages/PortfolioPage.tsx:48](../../frontend/src/pages/PortfolioPage.tsx#L48)). All three render raw token amounts. No USD value is shown, and the page header says so ([frontend/src/pages/PortfolioPage.tsx:194](../../frontend/src/pages/PortfolioPage.tsx#L194)).

`formatTokenAmount` truncates rather than rounds, strips trailing zeros, and renders `<0.000001` for a non-zero amount below the display precision ([frontend/src/lib/format.ts:32](../../frontend/src/lib/format.ts#L32)). A balance is never rounded up.

### Wrap and unwrap

One amount field drives both directions. Wrap calls WETH9 `deposit` with `msg.value`; unwrap calls `withdraw` with the amount ([frontend/src/pages/PortfolioPage.tsx:111](../../frontend/src/pages/PortfolioPage.tsx#L111), [frontend/src/pages/PortfolioPage.tsx:131](../../frontend/src/pages/PortfolioPage.tsx#L131)). Both are rejected unless the parsed amount is positive.

This exists because the protected pool is WETH/USDC. A user holding only native ETH cannot swap until they wrap, and the trade page links here when the WETH balance is short ([frontend/src/pages/TradePage.tsx:196](../../frontend/src/pages/TradePage.tsx#L196)).

### Allowances

Two cards, WETH and USDC, each showing the current allowance for the router and offering an exact-amount approve plus a revoke-to-zero ([frontend/src/pages/PortfolioPage.tsx:255](../../frontend/src/pages/PortfolioPage.tsx#L255)).

Approval is always for the exact amount the user types, never unlimited. Revoke always sets zero. The card text states that the router pulls only the approved amount ([frontend/src/components/AllowanceCard.tsx:53](../../frontend/src/components/AllowanceCard.tsx#L53)).

### Transaction handling

Every write goes through one `submit` helper: ensure Sepolia, set a pending message, send, wait for a receipt, refresh balances, clear the busy flag. A thrown error becomes the status line ([frontend/src/pages/PortfolioPage.tsx:90](../../frontend/src/pages/PortfolioPage.tsx#L90)).

The helper waits for the receipt but does not check `receipt.status`. A reverted transaction is therefore reported as success. The protected swap path does check the status ([frontend/src/hooks/useExecution.ts:285](../../frontend/src/hooks/useExecution.ts#L285)); this page does not.

## What it depends on

| Dependency | Why |
| --- | --- |
| Connected wallet | All reads and writes are per account; the page shows a connect prompt without one |
| WETH9 at `0xfff9…6b14` | Wrap, unwrap and the WETH balance |
| USDC at `0x1c7D…7238` | Balance and allowance |
| Router at `0x6332…150D` | Allowance target |
| Sepolia | `ensureSepolia` switches the wallet before each write |

## Interaction with the swap flow

The execution hook performs its own allowance check and, if short, approves exactly the swap amount ([frontend/src/hooks/useExecution.ts:167](../../frontend/src/hooks/useExecution.ts#L167)). So a user does not have to visit this page to approve; the approval happens inline as a separate wallet prompt during execution. The portfolio page is for pre-emptive approval, revoking, and wrapping.

The execution hook also checks the ERC-20 balance before submitting and refuses with a message naming the input token ([frontend/src/hooks/useExecution.ts:152](../../frontend/src/hooks/useExecution.ts#L152)). That check uses the WETH address when the input is labelled ETH.

## Known limitations

- **No receipt status check.** A reverted approve, revoke, wrap or unwrap is reported as done.
- **No allowance for other spenders.** The page only manages the router. A user who approved Permit2 or another router elsewhere sees nothing here.
- **One amount field for wrap and unwrap.** Typing an amount and pressing the wrong button acts on the same number; there is no per-direction field or validation against the actual ETH or WETH balance before submitting.
- **No balance validation before wrapping.** Wrapping more ETH than the wallet holds fails at the wallet or the transaction, not in the UI.
- **No USD or fiat context**, by design.
- **No transaction history for these actions.** Wrap, unwrap and approvals do not appear on the Activity page; only policy registration and swap enforcement do.
- **Balances refresh only on mount and after a write.** A swap executed on the trade page does refresh the input-token balance through `useTokenBalance`, but the portfolio page's own state is loaded once on mount and then only on the Refresh button.

## Related pages

- [Frontend service](../services/frontend.md).
- [Protected swap](protected-swap.md).
- [Data model](../architecture/data-model.md#the-erc-20-settlement-path).
