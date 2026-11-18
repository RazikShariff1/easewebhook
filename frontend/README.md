# EaseWebhook frontend (React + Vite + TypeScript)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, proxies /api -> http://localhost:8000
```

- Login/signup with email+password or Google (client ID is served by the backend's `/auth/config`;
  `http://localhost:5173` must be an authorised JavaScript origin for that client in Google Cloud Console).
- Pages: Connections (structured graph + table; drag a destination onto a source to connect them),
  Sources, Destinations, Transformations (JS editor with test run), Requests, Events (timeline, filters,
  attempts, retry/cancel, bulk actions), Metrics.
- Connection rules are drag-and-drop reorderable; they run top to bottom.
