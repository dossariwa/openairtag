# OpenAirTag

Real-time GPS device tracker. A Next.js dashboard shows enrolled devices on a Mapbox map, with location data stored and streamed via Convex.

## Architecture

```
tracker/ (Expo mobile app)
  ├── Requests GPS permission
  ├── Foreground + background location updates
  └── POSTs to /gps endpoint

src/ (Next.js web app)
  ├── /              → Public onboarding (QR code, install links)
  ├── /gps           → Hidden POST endpoint (receives GPS from tracker)
  ├── /dashboard     → Device list (auth-protected via Clerk)
  └── /dashboard/[id]→ Device detail with Mapbox map

convex/
  ├── schema.ts      → devices, latestLocations, locationHistory tables
  └── locations.ts   → enrollDevice, ingestLocation, listDevices, getDevice, getDeviceHistory
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Create `.env.local`:

```bash
# Convex
CONVEX_DEPLOYMENT=dev:your-deployment
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_JWT_ISSUER_DOMAIN=https://your-domain.clerk.accounts.dev

# Mapbox
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.eyJ...

# GPS ingest secret (shared with tracker app)
INGEST_SECRET=your-secret-here
```

### 3. Start Convex dev server

```bash
npx convex dev
```

### 4. Start Next.js

```bash
npm run dev
```

### 5. Enroll a device

Call the `enrollDevice` mutation from the Convex dashboard or CLI:

```bash
npx convex run locations:enrollDevice '{"deviceName": "My iPhone", "platform": "ios"}'
```

This returns `{ deviceUid, ingestToken }` — enter these in the tracker app.

### 6. Run the tracker app

```bash
cd tracker
npm install
npm start
```

Enter the server URL (e.g. `https://your-site.vercel.app`), device UID, and ingest token, then tap "Send Now" or enable background tracking.

## Routes

| Route | Auth | Description |
|---|---|---|
| `/` | Public | Onboarding page with QR code and install links |
| `/gps` | Bearer token | Hidden POST endpoint for GPS ingest |
| `/dashboard` | Clerk | Device list with real-time status |
| `/dashboard/[deviceUid]` | Clerk | Device detail with Mapbox map |

## Tech stack

- **Next.js 16** — web dashboard and API
- **Convex** — real-time database and backend functions
- **Clerk** — authentication for dashboard access
- **Mapbox GL** — map rendering
- **Expo** — iOS/Android tracker app
- **expo-location + expo-task-manager** — foreground/background GPS
