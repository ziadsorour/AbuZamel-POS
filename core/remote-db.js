// Online mode data layer (Supabase). Same methods as the local Database class in db.js.
// Active only when core/config.js defines window.AZ_CONFIG = { url, anonKey }.
(function () {
    const CFG = window.AZ_CONFIG;
    if (!CFG || !CFG.url || !CFG.anonKey) return;

    // Numeric fields that are changed relative to what the client last read, so two phones never overwrite each other.
    const DELTA_FIELDS = { products: ['stock'], customers: ['balance'], suppliers: ['balance'] };
    const SESSION_KEY = 'az_session_v1';
    const NET_MSG = 'مفيش اتصال بالإنترنت. اتأكد من النت وجرب تاني.';

    function uuid() {
        if (crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

    class RemoteDatabase {
        constructor() {
            this.isRemote = true;
            this.snap = new Map();
            this.session = null;
            this.me = null;
            try { this.session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { this.session = null; }
        }

        // ---------- auth ----------
        _saveSession(s) {
            this.session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || (Math.floor(Date.now() / 1000) + (s.expires_in || 3600)) } : null;
            if (this.session) localStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
            else localStorage.removeItem(SESSION_KEY);
        }

        async _fetch(url, opts) {
            try {
                return await fetch(url, opts);
            } catch (e) {
                const err = new Error(NET_MSG);
                err.network = true;
                throw err;
            }
        }

        async signIn(username, password) {
            const email = String(username || '').trim().toLowerCase() + '@abuzamel.app';
            const res = await this._fetch(`${CFG.url}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: { apikey: CFG.anonKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                const err = new Error('اسم المستخدم أو كلمة السر غير صحيحة');
                err.code = 'bad_login';
                throw err;
            }
            this._saveSession(body);
            this.me = await this.rpc('az_me', {});
            return this.me;
        }

        async refresh() {
            if (!this.session || !this.session.refresh_token) return false;
            const res = await this._fetch(`${CFG.url}/auth/v1/token?grant_type=refresh_token`, {
                method: 'POST',
                headers: { apikey: CFG.anonKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: this.session.refresh_token })
            });
            if (!res.ok) { this._saveSession(null); return false; }
            this._saveSession(await res.json());
            return true;
        }

        signOut() {
            this._saveSession(null);
            this.me = null;
            this.snap.clear();
        }

        async ensureLogin() {
            if (this.session) {
                try {
                    if (this.session.expires_at && this.session.expires_at - 60 < Date.now() / 1000) await this.refresh();
                    if (this.session) { this.me = await this.rpc('az_me', {}); return this.me; }
                } catch (e) {
                    if (e.network) throw e;
                    this.signOut();
                }
            }
            return null;
        }

        // ---------- transport ----------
        async rpc(fn, args, { retry = true } = {}) {
            const attempts = retry ? 4 : 1;
            let lastErr;
            for (let i = 0; i < attempts; i++) {
                try {
                    if (this.session && this.session.expires_at && this.session.expires_at - 30 < Date.now() / 1000) await this.refresh();
                    const token = this.session ? this.session.access_token : CFG.anonKey;
                    let res = await this._fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
                        method: 'POST',
                        headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
                        body: JSON.stringify(args || {})
                    });
                    if (res.status === 401 && this.session) {
                        if (await this.refresh()) {
                            res = await this._fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
                                method: 'POST',
                                headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + this.session.access_token, 'Content-Type': 'application/json' },
                                body: JSON.stringify(args || {})
                            });
                        }
                    }
                    const text = await res.text();
                    let body = null;
                    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
                    if (!res.ok) {
                        const msg = (body && body.message) || ('HTTP ' + res.status);
                        const err = new Error(msg);
                        err.code = msg;
                        err.status = res.status;
                        if (res.status >= 500 || res.status === 429) { lastErr = err; await sleep(400 * (i + 1)); continue; }
                        if (msg === 'not_authorized' || res.status === 401) {
                            this.signOut();
                            if (typeof window.azOnAuthLost === 'function') window.azOnAuthLost();
                        }
                        throw err;
                    }
                    return body;
                } catch (e) {
                    if (e.network && i < attempts - 1) { lastErr = e; await sleep(500 * (i + 1)); continue; }
                    throw e;
                }
            }
            throw lastErr || new Error('rpc failed');
        }

        // ---------- the Database API used by app.js ----------
        async init() {
            const me = await this.ensureLogin();
            if (!me) {
                if (typeof window.azShowLogin === 'function') await window.azShowLogin(this);
            }
            return this.me;
        }

        _remember(store, rec) {
            if (rec && typeof rec === 'object' && rec.id !== undefined) this.snap.set(store + ':' + rec.id, JSON.parse(JSON.stringify(rec)));
        }

        async getAll(storeName) {
            const rows = await this.rpc('az_get_all', { p_store: storeName });
            if (DELTA_FIELDS[storeName]) rows.forEach(r => this._remember(storeName, r));
            return rows;
        }

        async getById(storeName, id) {
            const key = storeName === 'dayClosures' ? String(id) : String(id);
            const row = await this.rpc('az_get', { p_store: storeName, p_key: key });
            if (row && DELTA_FIELDS[storeName]) this._remember(storeName, row);
            return row || undefined;
        }

        async getByDateRange(storeName, startDateStr, endDateStr) {
            return this.rpc('az_range', { p_store: storeName, p_from: startDateStr, p_to: endDateStr || startDateStr });
        }

        async getByIndex(storeName, indexName, keyRange) {
            const rows = await this.getAll(storeName);
            return rows.filter(r => keyRange && keyRange.includes ? keyRange.includes(r[indexName]) : true);
        }

        async getPaginated(storeName, limit = 50, offset = 0, direction = 'next') {
            const rows = await this.getAll(storeName);
            if (direction === 'prev') rows.reverse();
            return rows.slice(offset, offset + limit);
        }

        async add(storeName, data) {
            const clean = JSON.parse(JSON.stringify(data));
            delete clean.id;
            const res = await this.rpc('az_put', { p_store: storeName, p_data: clean, p_deltas: {}, p_req: uuid(), p_absolute: false });
            return storeName === 'dayClosures' ? res.key : res.id;
        }

        // opts.absolute = true writes the numeric fields exactly as given (owner-only recalculation).
        async update(storeName, data, opts = {}) {
            const clean = JSON.parse(JSON.stringify(data));
            const deltas = {};
            const fields = DELTA_FIELDS[storeName] || [];
            const hasId = storeName === 'dayClosures' ? !!clean.date : (clean.id !== undefined && clean.id !== null);
            if (hasId && fields.length && !opts.absolute) {
                const key = storeName + ':' + clean.id;
                let before = this.snap.get(key);
                if (!before) before = await this.getById(storeName, clean.id);
                if (before) {
                    for (const f of fields) {
                        const nv = Number(clean[f]), ov = Number(before[f]);
                        if (Number.isFinite(nv) && Number.isFinite(ov)) deltas[f] = round4(nv - ov);
                    }
                }
            }
            const res = await this.rpc('az_put', { p_store: storeName, p_data: clean, p_deltas: deltas, p_req: uuid(), p_absolute: !!opts.absolute });
            if (res && res.data && DELTA_FIELDS[storeName]) this._remember(storeName, res.data);
            return res.key !== undefined && /^[0-9]+$/.test(res.key) && storeName !== 'dayClosures' ? Number(res.key) : res.key;
        }

        async delete(storeName, id) {
            await this.rpc('az_delete', { p_store: storeName, p_key: String(id) });
            this.snap.delete(storeName + ':' + id);
        }

        async clearAllStores() {
            await this.rpc('az_clear_all', {}, { retry: false });
            this.snap.clear();
        }

        async importAll(data, onProgress) {
            const stores = ['products', 'customers', 'suppliers', 'purchases', 'audits', 'dayClosures', 'agents', 'invoices', 'expenses', 'inventoryLog', 'settlements', 'returns', 'users', 'customerPayments', 'supplierPayments'];
            const counts = {}, failed = [];
            let first = true, doneRows = 0;
            const grand = stores.reduce((t, st) => t + (Array.isArray(data[st]) ? data[st].length : 0), 0);
            try {
                for (const store of stores) {
                    const rows = Array.isArray(data[store]) ? data[store] : [];
                    counts[store] = 0;
                    if (!rows.length && !first) continue;
                    for (let i = 0; i === 0 || i < rows.length; i += 250) {
                        const res = await this.rpc('az_import_chunk', { p_store: store, p_rows: rows.slice(i, i + 250), p_reset: first });
                        first = false;
                        counts[store] += (res && res.ok) || 0;
                        ((res && res.failed) || []).forEach(f => failed.push({ store, key: f.key, error: f.error }));
                        doneRows += Math.min(250, rows.length - i);
                        if (onProgress) onProgress(store, doneRows, grand);
                    }
                }
            } catch (e) {
                // Server without the chunked function: fall back to the single-call restore
                if (first && /az_import_chunk|PGRST202|Could not find/i.test(String(e && e.message))) {
                    // Server has no chunked function yet: use the original single-call restore (keeps ids, counters and old costs).
                    // Never fall back to saving row by row: it is slow and would not move the id counters.
                    const c = await this.rpc('az_import', { p_data: data }, { retry: false });
                    this.snap.clear();
                    return c;
                }
                throw e;
            }
            this.snap.clear();
            counts.__failed = failed;
            return counts;
        }
    }

    window.RemoteDatabase = RemoteDatabase;
})();
