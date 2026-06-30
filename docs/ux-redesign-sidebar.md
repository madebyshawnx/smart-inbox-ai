# UX redesign — collapsible left sidebar + account/profile

**Goal:** restructure the inbox from the current flat two-pane (top bar + list +
detail) into a **three-zone layout with a persistent, collapsible left rail** —
the structure Gmail / Superhuman / ChatGPT use. Make navigation, counts, and the
account always visible. Build this first in the next session, iterating with
screenshots (`chrome-devtools` MCP) until it looks intentional.

## Target layout
```
+-----------+-----------------+----------------------+
| =  (Ask)  |  <bucket> list  |   <selected email>   |
| ----------|  compact rows   |   subject            |
| * Needs  3|                 |   why this matters   |
| * Follow 1|                 |   next step          |
| * Deadlns |                 |   feedback row       |
| * Money   |                 |                      |
| * ReadL.  |                 |                      |
| * Low     |                 |                      |
| ----------|                 |                      |
| Settings  |                 |                      |
| you@...   |                 |                      |
+-----------+-----------------+----------------------+
   LEFT RAIL        LIST              DETAIL
  (collapsible)
```

## Left rail (new — the core of this work)
- **Bucket nav**: one row per NON-EMPTY bucket (reuse `BUCKET_KEYS`/`BUCKET_LABELS`),
  each with a **live count** and the priority-tier color dot. Clicking a bucket
  **filters the middle list** to that bucket (replaces today's stacked sections).
  Add an "All / Daily brief" entry at top that shows everything + the brief.
- **Selected-bucket state**: clear active styling (accent bar / accent-soft).
- **Ask** entry pinned near the top (opens the existing `AskInbox`). Keep the
  command palette too.
- **Account/profile block pinned to the BOTTOM** of the rail:
  - Gmail avatar (initials) + connected address (from `/api/auth/google/status`).
  - A menu (or inline) with **Disconnect** ("sign out of Gmail" — there is no real
    auth yet; Disconnect IS the sign-out today) and **Settings** (opens the
    existing settings drawer: Connect / Smart Rules / Suggested Rules / Danger Zone).
  - If not connected: show a "Connect Gmail" CTA here instead.
- **Collapse toggle**: collapses the rail to an icon-only strip (dots + icons,
  counts as small badges) so the list/detail get a wider view. Persist the
  collapsed state in `localStorage`.

## Middle list
- Same compact rows as today, but **filtered to the selected bucket** (or all).
- Keep j/k keyboard nav within the filtered list. Section header shows the bucket
  name + count.

## Detail pane
- Unchanged content (summary, why-this-matters, next step, risk, confidence,
  feedback). Feedback row could get light grouping later, but not required here.

## Top bar
- Shrinks: the glanceable one-line brief stays; command-palette hint stays;
  Settings/Ask move into the rail. Keep it clean.

## Responsive
- `< md`: rail collapses to a top hamburger that opens it as an overlay; tapping a
  bucket shows the list; tapping a row shows detail (existing mobile back affordance).

## Implementation notes
- Most work is in `src/components/InboxWorkspace.tsx` (introduce a `LeftRail`
  sub-component + `selectedBucket` state + collapse state). The settings drawer,
  AskInbox, ConnectGmailCard, SmartRulesManager, OnboardingQuestionnaire all stay
  and are reachable from the rail — don't rewrite them.
- `/api/auth/google/status` already returns the connected email for the profile block.
- Keep all existing tests green; add tests for any new pure logic (e.g. a
  `filterBySelectedBucket` helper).
- Accessibility: rail is a `<nav>`; bucket items are buttons with `aria-current`;
  collapse toggle has an aria-label; account menu is keyboard-reachable.

## Definition of done
- Looks intentional in a 1440px screenshot (not a default template): clear
  hierarchy, the rail reads like a real product sidebar, counts + account always
  visible, collapse works and widens the inbox.
- All tests green; typecheck + biome clean; build green.
- Deploy (flip public -> push -> private, with the owner's OK).
