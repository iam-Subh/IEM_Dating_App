# IEM Connect

IEM Connect is an Expo and React Native mobile application with an Express, Prisma, PostgreSQL, Redis, and Socket.IO API.

Use the [updated application runbook](docs/updated-app-runbook.md) as the authoritative setup and operation guide. It covers:

- Required software
- API and mobile environment variables
- PostgreSQL and Redis startup
- Database migrations
- API and mobile startup
- Android development builds and physical-device connection
- Complete validation and isolated test commands
- Outbox and discovery maintenance
- Staging and production handoff
- Secret rotation and troubleshooting

Quick local start after the first setup:

```powershell
cd E:\IEM_Dating_App
npm run services:up
npm run dev:api
```

Open another terminal for the custom Expo development client:

```powershell
cd E:\IEM_Dating_App\apps\mobile
npx expo start --dev-client
```

Create a new SDK 57 native development build before the first device test:

```powershell
cd E:\IEM_Dating_App\apps\mobile
npx expo run:android
```
