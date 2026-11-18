// ── Profile photo URL refresh ───────────────────────────────────────────────
// Photos live privately in Firebase Storage (bus-pass-photos/<uid>/profile.jpg).
// The passPhotoUrl stored in Firestore is a signed URL that expires 7 days
// after upload, so when an <img> fails to load we ask the backend for a fresh
// one (GET /api/bus-pass/photo-url/:id, generated from passPhotoPath) and retry
// once. The placeholder is shown only if that refresh also fails.
//
// Requires the page to define API and headers() (admin JWT in Authorization).
// Usage:
//   <img src="${passPhotoSrc(s.id, s.passPhotoUrl)}" data-photo-id="${s.id}"
//        onerror="onPassPhotoError(this)" onclick="openPhotoViewer(this.src, name)">
(function () {
    const freshUrls = {};   // id -> fresh signed URL
    const pending = {};     // id -> Promise<string|null>
    const RETRY_AFTER_FAILURE_MS = 60 * 1000;
    const PLACEHOLDER = '<div style="width:52px;height:52px;border-radius:8px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="bi bi-person-fill" style="color:#94a3b8;font-size:20px"></i></div>';

    const AVATAR_PLACEHOLDER = '<span class="user-avatar user-avatar-empty"><i class="bi bi-person-fill"></i></span>';

    function fetchFreshPhotoUrl(id) {
        if (!pending[id]) {
            pending[id] = fetch(`${API}/api/bus-pass/photo-url/${encodeURIComponent(id)}`, { headers: headers(), cache: "no-store" })
                .then(r => (r.ok ? r.json() : null))
                .then(d => {
                    if (d && d.success && d.photoUrl) { freshUrls[id] = d.photoUrl; return d.photoUrl; }
                    return null;
                })
                .catch(() => null)
                .then(url => {
                    // Failed lookups may be retried later (e.g. after a network blip),
                    // but not by every re-render in the meantime.
                    if (!url) setTimeout(() => { delete pending[id]; }, RETRY_AFTER_FAILURE_MS);
                    return url;
                });
        }
        return pending[id];
    }

    // Best known URL for a student's photo: a fresh one if we have it, else the stored one.
    window.passPhotoSrc = function (id, storedUrl) {
        return freshUrls[id] || storedUrl || "";
    };

    window.onPassPhotoError = function (img) {
        const id = img.getAttribute("data-photo-id");
        // One refresh attempt per <img>: a fresh URL that also fails shows the placeholder.
        const empty = img.getAttribute("data-avatar") === "round" ? AVATAR_PLACEHOLDER : PLACEHOLDER;
        if (!id || img.getAttribute("data-photo-refreshed") === "1") { img.outerHTML = empty; return; }
        img.setAttribute("data-photo-refreshed", "1");
        const failed = img.getAttribute("src");
        fetchFreshPhotoUrl(id).then(url => {
            if (!img.isConnected) return;
            if (url && url !== failed) img.src = url;
            else img.outerHTML = empty;
        });
    };

    // Round avatar for the Users tables. Same photo source and refresh path as
    // the Bus Pass page: passPhotoUrl -> passPhotoSrc -> onPassPhotoError.
    window.userAvatarHtml = function (u) {
        const url = u && u.passPhotoUrl ? passPhotoSrc(u.id, u.passPhotoUrl) : "";
        if (!url) return AVATAR_PLACEHOLDER;
        const esc = s => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
        return `<img class="user-avatar" src="${esc(url)}" alt="${esc(u.name || "User")}" loading="lazy" data-photo-id="${esc(u.id)}" data-avatar="round" onerror="onPassPhotoError(this)">`;
    };
})();
