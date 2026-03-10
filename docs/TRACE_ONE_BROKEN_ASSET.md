# Trace one broken asset — evidence only

**Assumption:** Backend is running. Do not suggest "start the server."

**Goal:** For one broken image or video, collect exact runtime evidence so we can see whether the failure is wrong URL, 404, wrong content, DOM not rendered, or CSS hiding.

---

## 1. Asset chosen (code trace)

**Example: Home page — cabin hero (left pane)**

| What | Value |
|------|--------|
| **Component** | `client/src/components/DualityHero.jsx` |
| **Rendered as** | Either `<img src={poster}>` or `<video poster={poster}><source src={videoSource}>` |
| **Condition** | `shouldPlayVideo = shouldLoadMedia && !prefersReducedMotion && !isLowBandwidth`. If **false** → `<img>`. If **true** → `<video>`. |
| **Source of `poster` (cabin left)** | `CABIN_STILLS[season]` → literal `/uploads/Videos/The-cabin-header.winter-poster.jpg` (both seasons use winter poster in code) |
| **Source of `videoSource` (cabin left)** | `CABIN_VIDEOS[season]` → `/uploads/Videos/The-cabin-header.winter.mp4` or `.summer.mp4` |
| **DOM location** | Inside `<section ref={containerRef}>` → (mobile: div.relative.flex-1 > div.relative > **img or video**) or (desktop: motion.div.absolute.left-0 > div.relative > **img or video**). No conditional that skips rendering the media element. |
| **Expected request URL (poster)** | `http://localhost:3000/uploads/Videos/The-cabin-header.winter-poster.jpg` (relative from client; Vite proxies to 5000) |
| **CSS** | Media has `className="absolute inset-0 w-full h-full object-cover"` + inline `mediaStyle` (transform scale, objectPosition). Parent chain uses `relative`, `overflow-hidden`, no `display:none` or `visibility:hidden` on this component. |

So for this asset we expect:
- **Exact request URL:** `/uploads/Videos/The-cabin-header.winter-poster.jpg` (full: `http://localhost:3000/uploads/Videos/The-cabin-header.winter-poster.jpg`)
- **Element:** One of `<img>` or `<video>` in the left hero pane; if `<video>`, it also has a `<source>` requesting the mp4.

---

## 2. What to do in the browser (report back with evidence)

Open the app (home page). Open DevTools (F12) → **Network** tab. Reload. Filter by **Img** or **Media** if needed.

### A. Find one failed request

1. Find a request whose path is under `/uploads/` and that is **red** (failed) or has status **404** or **failed**.
2. Click that request.

**Report:**

- **Request URL (exact):** `_________________________`
- **Status code:** `_________________________`
- **Response headers:** (copy the first few lines, or paste `Content-Type` and `Content-Length` if present)
- **Response preview / body:** (e.g. "HTML 404 page" vs "binary image" vs "empty" vs "CORS error")

If the request returns **200**:

- **Content-Type:** `_________________________`
- **Response size / preview:** (e.g. "image/jpeg, 45 KB" or "HTML document")

### B. DOM and final `src`

1. Open **Elements** (Inspector). Find the **left hero pane** (first big block with "The Cabin" / "Drift" text).
2. Inside it, find the `<img>` or `<video>` that should show the cabin.

**Report:**

- **Is the element present?** Yes / No
- **Tag:** `<img>` or `<video>`
- **Final `src` (for img) or `poster` / `<source src>` (for video):** `_________________________`
- If **not present:** describe what you see instead (e.g. only overlay divs, no media tag). Then we know a **component condition** is preventing render.

### C. Computed style (if element exists but not visible)

1. With the `<img>` or `<video>` selected, open **Computed** (or Styles → computed).
2. Check:

**Report:**

- **display:** `_________________________`
- **visibility:** `_________________________`
- **opacity:** `_________________________`
- **width / height:** `_________________________`
- **overflow (on element or any parent in that hero pane):** `_________________________`

If any of: `display: none`, `opacity: 0`, `visibility: hidden`, or width/height **0**, that explains "media missing" even when the request is 200.

---

## 3. How to interpret (no guessing)

| Evidence | Conclusion |
|----------|------------|
| Request **404** | Wrong path or file missing on server. Fix: align code path with file on disk or add file. |
| Request **failed** (e.g. CORS, connection refused) | Network/proxy/backend reachability. Not "media path in code". |
| Request **200** but **Content-Type** is text/html or wrong type | Server returning error page or wrong resource. Check server routing and static root. |
| Request **200**, correct type, size &gt; 0 | Server and URL are fine. Problem is **DOM** or **CSS** (element not there or hidden). |
| **Element not in DOM** | A **component condition** is preventing render (e.g. `shouldLoadMedia` false and something else removed the fallback, or wrong branch). |
| **Element in DOM**, correct `src`, but **display:none / opacity:0 / 0×0** | **Layout/CSS** is hiding or collapsing the media. |

---

## 4. Next step

Fill in the **Report** sections (A, B, C) from your DevTools and share that. With one concrete asset traced like this we can fix the real cause (wrong URL, 404, wrong content, no DOM node, or CSS) instead of guessing.
