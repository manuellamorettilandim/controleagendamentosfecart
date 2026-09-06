# Admin workspace redesign

The admin page now follows the user dashboard's Fecart palette, typography family, rounded surfaces, blue actions, and persisted light/dark theme.

## Changes

- A focused overview prioritizes pending approvals, platform metrics, quick actions, and account capacity.
- Dedicated hash-addressable views: /admin#overview, #approvals, #agenda, #accounts, #policies and #reports.
- Approvals retain the existing review modal, decisions, justification, and backend handlers. The approvals view includes search; overview shows the first three requests.
- Calendar retains account selection, week/day/list modes, period navigation, and reservation management. Small screens initially use the list view.
- Account creation/OAuth, removal, token management and history handlers are retained.
- Access policies have their own workspace, retaining the existing settings API.
- New report form calls the existing authenticated usage export endpoints for PDF, XLSX, and CSV. It validates the date range, uses Brasília day boundaries, prevents repeated submits, and reports errors.
- Existing groups and statistics/audit pages remain accessible through navigation.
- Mobile navigation scrolls horizontally, cards stack, and logout remains accessible. Desktop sidebar can collapse. Local theme preferences are retained.
- Missing quota measurements remain unavailable rather than displaying an artificial zero.

## Files

Primary changes: web/src/templates/admin.html, web/src/styles/admin-workspace.css, web/src/legacy/admin.js, web/src/legacy/admin-shell.js, web/src/entries/admin.tsx, web/src/legacy/admin.test.ts.

A `dev` alias and explicit development host configuration were added for preview compatibility. No dependency changes or database migrations are required. The original backend, user page, installation instructions and lockfile are retained.

## Running

Use the existing README and .env.example to configure your backend/database. Run `npm ci`, `npm run build`, then the existing relay/local startup procedure. For frontend development, `npm run dev:web` or `npm run dev` starts Vite. Authenticate using your configured administrator account and open /admin.

## Validation

- `npm run build`: passed (server TypeScript, web TypeScript and Vite production build).
- `npm run test:web`: 14 files / 46 tests passed. Includes existing reservation-review tests plus new task-view, invalid-date, authorized-export request and failed-download recovery coverage.
- Browser checks: desktop overview, review dialog, reports/policies navigation, light theme, and a 390px iframe viewport for mobile layout. The mobile document had equal client and scroll widths (375px content plus browser scrollbar), with no horizontal page overflow.
- Screenshots in screenshots/ use isolated synthetic account/reservation data. This preview harness and its authentication/API mocks are excluded from the ZIP and production build.
- No live database, OAuth account, or production export service was configured in this workspace. Real approvals, account provisioning and generated document contents must be smoke-tested against your configured backend before release. Existing groups/statistics pages were preserved rather than rebuilt.

The ZIP contains full source, not node_modules or generated build directories. Screenshots are actual browser captures; the mobile capture is cropped to its 390px preview viewport without altering page content.
