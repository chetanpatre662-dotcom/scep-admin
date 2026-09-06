# College Management System — Frontend (Phase 1)

A production-quality, **frontend-only** College Management System for an engineering
college, covering **Faculty**, **Student** and **Admin** roles. Built with plain
HTML5, CSS3 and modular vanilla JavaScript (ES modules) — no frameworks.

This phase ships a complete, polished UI plus a **data/service abstraction layer**
so the backend (Node.js + Express + PostgreSQL), Firebase Auth/Storage and
WebSocket can be integrated later **without rewriting the UI**.

---

## Quick start

Because the app uses ES modules, open it through a local web server (not `file://`):

```bash
# From inside the college-management-system folder
python -m http.server 8000
# then visit http://localhost:8000/index.html
```

Any static server works (VS Code Live Server, `npx serve`, etc.).

### Demo credentials

| Role    | Email               | Password     |
|---------|---------------------|--------------|
| Faculty | faculty@miet.edu    | faculty123   |
| Student | student@miet.edu    | student123   |
| Admin   | admin@miet.edu      | admin123     |

Mock data lives in `localStorage`. Reset it anytime from **Admin → Settings → Data & Reset**.

---

## Project structure

```
college-management-system/
├── index.html                  # Landing / role selection
│
├── faculty/                    # Faculty pages (thin HTML shells)
│   ├── login.html
│   ├── dashboard.html
│   ├── classes.html
│   ├── announcements.html
│   └── question-papers.html
│
├── student/
│   ├── login.html
│   ├── dashboard.html
│   ├── announcements.html
│   └── question-papers.html
│
├── admin/
│   ├── login.html
│   ├── dashboard.html
│   ├── faculty.html
│   ├── students.html
│   ├── courses.html
│   └── settings.html
│
├── css/
│   ├── global.css              # Design system (tokens, buttons, forms, tables, modals, toasts)
│   ├── auth.css                # Login pages
│   ├── dashboard.css           # Shared app shell (sidebar/header)
│   ├── faculty.css             # Faculty accents + class wizard/cards
│   ├── student.css             # Student accents + announcement feed
│   └── admin.css               # Admin accents + course accordion/settings
│
├── js/
│   ├── config.js               # Domain constants, ROUTES, ENV flags (USE_MOCK)
│   │
│   ├── data/
│   │   └── mockData.js         # All seed datasets (kept out of HTML)
│   │
│   ├── services/               # DATA ABSTRACTION LAYER (swap point for backend)
│   │   ├── store.js            # localStorage-backed persistence for mocks
│   │   ├── apiClient.js        # HTTP seam (Phase 2)
│   │   ├── authService.js      # login/logout/session + route guard
│   │   ├── classService.js
│   │   ├── announcementService.js
│   │   ├── questionPaperService.js
│   │   ├── studentService.js
│   │   ├── facultyService.js
│   │   └── websocketService.js # Real-time seam (Phase 2)
│   │
│   ├── common/                 # Reusable UI building blocks
│   │   ├── icons.js            # Inline SVG icon set
│   │   ├── dom.js              # $, esc, formatDate, debounce, uid, …
│   │   ├── toast.js            # Toast notifications
│   │   ├── modal.js            # Modal + confirm dialog
│   │   ├── validation.js       # Form validation
│   │   ├── components.js       # Empty/loading/error states, badges, pagination
│   │   ├── layout.js           # Sidebar + header app shell
│   │   └── loginPage.js        # Shared login controller
│   │
│   ├── faculty/  (nav.js, dashboard.js, classes.js, announcements.js, question-papers.js)
│   ├── student/  (nav.js, dashboard.js, announcements.js, question-papers.js)
│   └── admin/    (nav.js, dashboard.js, faculty.js, students.js, courses.js, settings.js)
│
├── assets/ (images / icons / logos)
└── README.md
```

---

## Architecture

**UI never talks to data directly.** Every page controller calls a service
(`classService.getClasses()`, `announcementService.getForStudent()`, …). Services
currently read/write mock data through `store.js` (localStorage) and return
**Promises**, so the UI is already async-ready.

```
Page controller  →  Service (Promise)  →  [ Phase 1: mock store ]
                                          [ Phase 2: apiClient → REST API ]
```

Two dedicated seams document exactly where backend work plugs in:

- `services/apiClient.js` — the single place real HTTP calls (and the Firebase
  auth token) will be added.
- `services/websocketService.js` — a no-op event bus today (`subscribe`/`emit`)
  that becomes a real WebSocket client in Phase 2.

A global flag, `ENV.USE_MOCK` in `config.js`, is the master switch between mock
and live data.

---

## Backend integration plan (Phase 2)

The UI should not need meaningful changes. The work is localized to the services:

1. **Auth (Firebase Authentication)** — In `authService.login()`, replace the mock
   branch with `signInWithEmailAndPassword`, then load the user's role/profile.
   `getSession()`/`requireRole()` keep the same signatures.
2. **REST API (Node + Express)** — Implement `apiClient.request()`, set
   `ENV.USE_MOCK = false`, and change each service method's body from a `store`
   call to `apiClient.request('/classes', …)`. Return shapes stay the same.
3. **PostgreSQL** — Backend concern only; the frontend just consumes JSON.
4. **File storage (Firebase Cloud Storage)** — In `questionPaperService.uploadPaper()`
   and the announcement attachment field, upload the `File` and store the returned
   download URL on the record (the `file` field already represents this).
5. **Real-time (WebSocket)** — Implement `websocketService.connect()` against
   `ENV.WS_URL`. Pages subscribe with `subscribe('announcement:new', cb)` to update
   live when a faculty member publishes.

Target real-time flow:

```
Faculty publishes → backend saves to PostgreSQL + emits event
                  → WebSocket pushes to targeted students
                  → student dashboards update instantly
```

---

## Security notes

- No credentials, API keys or secrets are stored in the frontend.
- All user-generated content is HTML-escaped (`esc()`) before rendering.
- Frontend validation is for UX only; the backend must re-validate every request
  and enforce authorization server-side.
```
