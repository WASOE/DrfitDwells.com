# Why media might not show in dev

## 1. Backend must be running

**All `/uploads/` requests are served by the backend.** The Vite dev server only proxies them:

- Browser requests: `http://localhost:3000/uploads/Videos/...`
- Vite proxies to: `http://localhost:5000/uploads/Videos/...`
- If nothing is listening on port 5000, you get **404** and images/videos don’t load.

**Do this:**

- From **repo root**: run `npm run dev`  
  → starts both server (5000) and client (3000).
- Or in one terminal: `npm run server`  
  In another: `npm run client`.

Do **not** run only `cd client && npm run dev` and expect media to work unless the server is already running elsewhere.

## 2. Check that the server is actually serving uploads

From repo root:

```bash
node scripts/check-uploads-serving.mjs
```

Default base URL is `http://localhost:5000`. If the server is on another host/port:

```bash
node scripts/check-uploads-serving.mjs http://localhost:5000
```

You should see `200` for each path. If you see connection errors or 404, the server isn’t running or isn’t serving from the right `uploads/` folder.

## 3. Where the server looks for files

The backend serves from **repo root** `uploads/`:

- `server/server.js`: `uploadsDir = path.join(__dirname, '..', 'uploads')`
- So files must be under `<repo>/uploads/` (e.g. `uploads/Videos/`, `uploads/The Valley/`, `uploads/Content website/`).

No code changes are required for this; just ensure the server process is started from the repo that contains this `uploads/` directory.

## 4. If it still doesn’t show

1. **Browser Network tab**  
   Find a failing image or video request. Note the **exact URL** (e.g. `http://localhost:3000/uploads/The%20Valley/...`).

2. **Test that URL on the backend**  
   Open or curl: `http://localhost:5000/uploads/...` (same path as in the failing request).  
   If that returns 404, the problem is backend (path or file missing).  
   If that returns 200 but the app still doesn’t show it, the problem is in the client (wrong URL in code or component).

3. **Validator**  
   Run `cd client && npm run validate:media` to ensure every referenced path exists on disk. Fix any missing paths in code (e.g. in `imageMetadata.js` or components) to match real filenames under `uploads/`.
