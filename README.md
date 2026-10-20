# OpenAirTag

A Next.js dashboard for enrolled GPS trackers, plus voluntary, temporary browser location sharing. Convex stores and streams location data; Clerk signs in dashboard owners; Mapbox renders locations; the separate Expo app sends device GPS updates.

## Routes and data flow

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | Public | Tracker onboarding and dashboard link |
| `/gps` | Device UID + ingest token in JSON | Existing Expo enrollment and GPS ingestion |
| `/dashboard` | Clerk + Convex authentication | Devices paired to the signed-in owner |
| `/dashboard/[deviceUid]` | Owner only | Device map and location history |
| `/dashboard/shares` | Owner only | Create, revoke, and delete temporary invitations |
| `/dashboard/shares/[sessionId]` | Owner only | Latest shared location, accuracy, and last update |
| `/share#token=…` | Invitation capability | Explicit participant consent and controls |

`src/` contains the web app, `convex/` contains data and authorization, and `tracker/` contains the Expo mobile app. Temporary browser shares use a separate `sharingSessions` table; device history is unchanged.

## Local setup

```bash
npm ci
cp .env.example .env.local
```

Fill `.env.local` using your own development configuration. Never commit it. Configure the Clerk `convex` JWT template and set the same `CLERK_JWT_ISSUER_DOMAIN` in your **development Convex deployment**. The backend rejects authenticated operations when no valid identity is available.

`NEXT_PUBLIC_CONVEX_URL` identifies the frontend endpoint; the Convex CLI also requires `CONVEX_DEPLOYMENT`. Confirm the target before running `npx convex dev`, since that command uploads functions and schema to the selected deployment. It must not point at production for local development.

```bash
npm run convex:dev
npm run dev
```

Open `http://localhost:3000`. Public deployment requires HTTPS for browser geolocation. Use a Mapbox public token restricted to your intended origins.

## Voluntary sharing

1. Sign in and open **Voluntary location sharing** from the dashboard.
2. Enter a purpose and choose 15, 30, or 60 minutes. Expiry starts when the invitation is created. Copy the invitation link and share it yourself.
3. The participant sees the recipient account, verified email if supplied by Clerk, purpose, expiry, retention, and controls. Opening the page does not request or send a location.
4. The participant checks the consent box and presses **I agree — start sharing my location**. Only then can the browser request location permission.
5. The owner sees only the latest coordinate, accuracy, and last update. The invite link cannot read coordinates; viewing requires the owner's authenticated account.
6. **Stop sharing**, owner revocation, or expiry prevents further updates and removes the latest coordinate. **Delete my data** deletes the full session immediately. Expiry schedules full session deletion, and all backend reads/writes independently enforce expiry even if cleanup is delayed.

Tokens are generated with cryptographic randomness, stored on the backend as SHA-256 hashes, and carried in the URL fragment so they are not included in HTTP paths or referrer headers. One participant browser can claim an invitation. A separate browser credential controls stopping/deletion and is stored locally for that invitation. Keep that browser's site storage if you need to return and manage the session; clearing it loses the control credential. Never treat an invitation as proof of a person's identity.

Only the latest location is kept for browser shares; no movement history is created. The page pauses updates when hidden, offline, or closed and requires an explicit resume. Last location can remain visible until confirmed stop, revocation, or expiry. If the network is unavailable during stop/delete, the page stops reading location immediately and reports that server confirmation is still pending. Browser background tracking is not promised. Reopening or refreshing never silently restarts GPS. Backend deletion covers application records; deployment logs/backups have separate provider retention policies.

## Existing devices and ownership

The `/gps` JSON contract and Expo foreground/background tracking remain available. Anonymous users and other owners cannot list, read, or delete devices. Existing hosted `userId` ownership, setup links, subscription records, and indexes are retained. Already owned devices stay with their current account without re-pairing. The additional ownership fields are optional, so the schema change does not require deleting old devices.

To pair a previously enrolled, unowned device:

1. On the tracker, choose **Show pairing details**. Values are hidden by default and when the app backgrounds.
2. Sign into the web dashboard and open **Pair an existing device**.
3. Enter the device ID and pairing token. Only possession of the existing token allows claiming an unowned device; a device already claimed by another owner cannot be reassigned this way.

Old tracker builds store these details under `openairtag-device` in their existing AsyncStorage. Install the updated tracker to show them. There is no automatic assignment of unowned records to the next person who signs in. Do not send pairing tokens in chat, logs, or screenshots.

Device deletion hides the device immediately and deletes history in bounded background batches. Stop the native tracker first if you do not want future uploads: an older still-running tracker can enroll itself again after complete deletion, as an unowned device. Temporary browser share stop/revocation is permanent for that invitation.

```bash
cd tracker
npm ci
npm start
```

The existing tracker server URL is in `tracker/app/index.tsx`; native background tracking requires the platform's permissions and a supported development/production build.

## Verification

```bash
npm run typecheck
npm test
npm run lint
npm run build
cd tracker && npx tsc --noEmit
```

Tests exercise real Convex handlers in `convex-test` and mock browser geolocation explicitly. They cover owner isolation, claim/token secrecy, consent, stale callbacks, visibility/offline pauses, expiry, server deletion, and existing device ingestion. Synthetic test coordinates are not evidence of physical-device GPS or native background operation.

Before release, verify the exact Convex URL already used by Vercel, its Clerk JWT issuer, and the authenticated workflow. `convex deploy` selects a project's default production deployment, which may differ from the backend an existing site uses. Do not switch to that different backend without an explicit data migration. For an existing site using a named cloud development deployment, select that exact deployment in a separate release workspace and use `convex dev --once` to update it deliberately. Vercel frontend and Convex backend must be released together.

The hosted legacy billing helpers remain available to trusted server integrations as internal functions. `users.getByClerkId`, `users.setStripeCustomerId`, and `subscriptions.upsertSubscription` require server/admin access; browser clients cannot write subscription entitlements or another user's billing identity.
