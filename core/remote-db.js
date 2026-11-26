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


    // ---------- Offline support: local copy of the data + a queue of changes made without internet ----------
    const ALL_STORES = ['products', 'customers', 'suppliers', 'purchases', 'audits', 'dayClosures', 'agents', 'invoices', 'expenses', 'inventoryLog', 'settlements', 'returns', 'users', 'customerPayments', 'supplierPayments'];
    const WARM_STORES = ['products', 'customers', 'agents', 'invoices', 'customerPayments', 'returns', 'dayClosures', 'suppliers', 'expenses', 'purchases', 'settlements', 'supplierPayments', 'audits'];
    const MIRROR_MAX_AGE = 2 * 3600 * 1000;

    class Mirror {
        constructor(username) { this.name = 'az_mirror_' + username; this.db = null; this.chain = Promise.resolve(); }
        open() {
            if (this.db) return Promise.resolve(this.db);
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(this.name, 1);
                req.onupgradeneeded = () => {
                    const d = req.result;
                    ALL_STORES.forEach(st => { if (!d.objectStoreNames.contains('s_' + st)) d.createObjectStore('s_' + st, { keyPath: 'k' }); });
                    d.createObjectStore('meta', { keyPath: 'k' });
                    d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
                };
                req.onsuccess = () => { this.db = req.result; resolve(this.db); };
                req.onerror = () => reject(req.error);
            });
        }
        async _tx(stores, mode, fn) {
            const d = await this.open();
            return new Promise((resolve, reject) => {
                const tx = d.transaction(stores, mode);
                let out;
                try { out = fn(tx); } catch (e) { reject(e); return; }
                tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('tx aborted'));
            });
        }
        _req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
        keyOf(store, rec) { return String(store === 'dayClosures' ? rec.date : rec.id); }
        replaceAll(store, rows) {
            // serialized, so two refreshes never interleave
            this.chain = this.chain.then(async () => {
                await this._tx(['s_' + store, 'meta'], 'readwrite', tx => {
                    const os = tx.objectStore('s_' + store);
                    os.clear();
                    rows.forEach(r => { try { os.put({ k: this.keyOf(store, r), d: r }); } catch (e) {} });
                    tx.objectStore('meta').put({ k: 'at_' + store, v: Date.now() });
                });
            }).catch(() => {});
            return this.chain;
        }
        putRow(store, rec) {
            this.chain = this.chain.then(() => this._tx(['s_' + store], 'readwrite', tx => { tx.objectStore('s_' + store).put({ k: this.keyOf(store, rec), d: rec }); })).catch(() => {});
            return this.chain;
        }
        delRow(store, key) {
            this.chain = this.chain.then(() => this._tx(['s_' + store], 'readwrite', tx => { tx.objectStore('s_' + store).delete(String(key)); })).catch(() => {});
            return this.chain;
        }
        async getRow(store, key) {
            await this.chain;
            const d = await this.open();
            const r = await this._req(d.transaction(['s_' + store], 'readonly').objectStore('s_' + store).get(String(key)));
            return r ? r.d : undefined;
        }
        async getAll(store) {
            await this.chain;
            const d = await this.open();
            const rows = (await this._req(d.transaction(['s_' + store], 'readonly').objectStore('s_' + store).getAll())).map(x => x.d);
            if (store === 'dayClosures') rows.sort((a, b) => (a.date < b.date ? -1 : 1));
            else rows.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
            return rows;
        }
        async age(store) {
            await this.chain;
            const d = await this.open();
            const m = await this._req(d.transaction(['meta'], 'readonly').objectStore('meta').get('at_' + store));
            return m ? Date.now() - m.v : Infinity;
        }
        async has(store) { return (await this.age(store)) !== Infinity; }
        async addOp(op) { await this.chain; return this._tx(['outbox'], 'readwrite', tx => { const r = tx.objectStore('outbox').add(op); return r; }).then(() => {}); }
        async ops() { await this.chain; const d = await this.open(); return this._req(d.transaction(['outbox'], 'readonly').objectStore('outbox').getAll()); }
        async putOp(op) { return this._tx(['outbox'], 'readwrite', tx => { tx.objectStore('outbox').put(op); }); }
        async delOp(seq) { return this._tx(['outbox'], 'readwrite', tx => { tx.objectStore('outbox').delete(seq); }); }
    }

    class RemoteDatabase {
        constructor() {
            this.isRemote = true;
            this.snap = new Map();
            this.session = null;
            this.me = null;
            this.mirror = null;
            this.offline = false;
            this.syncing = false;
            this.pending = 0;
            this.failed = [];
            this._syncTimer = null;
            try { this.session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { this.session = null; }
        }

        // ---------- auth ----------
        _saveSession(s) {
            this.session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || (Math.floor(Date.now() / 1000) + (s.expires_in || 3600)) } : null;
            if (this.session) localStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
            else localStorage.removeItem(SESSION_KEY);
        }

        async _fetch(url, opts, timeoutMs) {
            if (navigator.onLine === false) { const err = new Error(NET_MSG); err.network = true; throw err; }
            let timer = null;
            try {
                if (typeof AbortController !== 'undefined') {
                    const ac = new AbortController();
                    timer = setTimeout(() => ac.abort(), timeoutMs || 60000);
                    opts = Object.assign({}, opts, { signal: ac.signal });
                }
                return await fetch(url, opts);
            } catch (e) {
                const err = new Error(NET_MSG);
                err.network = true;
                throw err;
            } finally { if (timer) clearTimeout(timer); }
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
            this._cacheMe();
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
                    if (this.session) { this.me = await this.rpc('az_me', {}, { attempts: 2, timeout: 15000 }); this._cacheMe(); return this.me; }
                } catch (e) {
                    if (e.network) {
                        // no internet at startup: keep working from the saved copy of the data
                        let cached = null;
                        try { cached = JSON.parse(localStorage.getItem('az_me_cache') || 'null'); } catch (x) { cached = null; }
                        if (cached && this.session) { this.me = cached; this._openMirror(); return this.me; }
                        throw e;
                    }
                    this.signOut();
                }
            }
            return null;
        }

        // ---------- transport ----------
        async rpc(fn, args, { retry = true, attempts: att, timeout } = {}) {
            const attempts = att || (retry ? 4 : 1);
            let lastErr;
            for (let i = 0; i < attempts; i++) {
                try {
                    if (this.session && this.session.expires_at && this.session.expires_at - 30 < Date.now() / 1000) await this.refresh();
                    const token = this.session ? this.session.access_token : CFG.anonKey;
                    let res = await this._fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
                        method: 'POST',
                        headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
                        body: JSON.stringify(args || {})
                    }, timeout);
                    if (res.status === 401 && this.session) {
                        if (await this.refresh()) {
                            res = await this._fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
                                method: 'POST',
                                headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + this.session.access_token, 'Content-Type': 'application/json' },
                                body: JSON.stringify(args || {})
                            }, timeout);
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
                    this._setOffline(false);
                    return body;
                } catch (e) {
                    if (e.network && i < attempts - 1) { lastErr = e; await sleep(500 * (i + 1)); continue; }
                    if (e.network) this._setOffline(true);
                    throw e;
                }
            }
            throw lastErr || new Error('rpc failed');
        }


        // ---------- offline copy + outbox ----------
        _cacheMe() { try { localStorage.setItem('az_me_cache', JSON.stringify(this.me)); } catch (e) {} this._openMirror(); }
        _openMirror() {
            const u = (this.me && this.me.username) || 'user';
            if (!this.mirror || this.mirror.name !== 'az_mirror_' + u) { this.mirror = new Mirror(u); this._refreshPending(); }
            return this.mirror;
        }
        _setOffline(v) {
            if (this.offline === v) return;
            this.offline = v;
            this._emit();
            if (v) this._probeSoon();
            if (!v) this.syncSoon(300);
        }
        _emit() {
            try { window.dispatchEvent(new CustomEvent('az-sync', { detail: { offline: this.offline, pending: this.pending, failed: this.failed.length, syncing: this.syncing } })); } catch (e) {}
        }
        async _refreshPending() {
            try {
                const ops = await this.mirror.ops();
                this.pending = ops.filter(o => !o.failed).length;
                this.failed = ops.filter(o => o.failed);
            } catch (e) {}
            this._emit();
        }
        async _hasPending() { try { return (await this.mirror.ops()).some(o => !o.failed); } catch (e) { return false; } }
        _offId(store) {
            // ids made without internet come from a block of numbers that belongs to this phone, so two phones never clash
            let slot = Number(localStorage.getItem('az_slot'));
            if (!slot) { slot = 1 + Math.floor(Math.random() * 89); localStorage.setItem('az_slot', String(slot)); }
            const key = 'az_offid_' + store;
            let n = Number(localStorage.getItem(key)) || 0;
            if (n >= 9999) { slot = 1 + Math.floor(Math.random() * 89); localStorage.setItem('az_slot', String(slot)); n = 0; }
            n++;
            localStorage.setItem(key, String(n));
            return (store === 'inventoryLog' ? 10000000 : 100000) + slot * 10000 + n;
        }
        async _queue(fn, store, data, deltas, absolute, key, isNew) {
            const m = this._openMirror();
            const op = { fn, store, data, deltas: deltas || {}, absolute: !!absolute, key: key !== undefined ? String(key) : undefined, req: uuid(), at: Date.now(), attempted: false, isNew: !!isNew };
            await m.addOp(op);
            if (fn === 'put') await m.putRow(store, data);
            else if (fn === 'del') await m.delRow(store, key);
            await this._refreshPending();
            if (navigator.onLine !== false) this.syncSoon(1500);
        }
        _probeSoon() {
            if (this._probing) return;
            this._probing = setTimeout(async () => {
                this._probing = null;
                if (!this.offline || !this.me) return;
                try { await this.rpc('az_me', {}, { attempts: 1, timeout: 8000 }); } catch (e) { this._probeSoon(); }
            }, 10000);
        }
        syncSoon(ms) {
            clearTimeout(this._syncTimer);
            this._syncTimer = setTimeout(() => this.sync().catch(() => {}), ms || 0);
        }
        async sync() {
            if (this.syncing || !this.me) return 0;
            const m = this._openMirror();
            let ops = await m.ops();
            ops = ops.filter(o => !o.failed);
            if (!ops.length) { this._emit(); return 0; }
            this.syncing = true; this._emit();
            let done = 0, stop = false;
            try {
                for (const op of ops) {
                    try {
                        if (op.fn === 'put') {
                            const newKey = op.isNew && !op.attempted;
                            if (newKey) {
                                const there = await this.rpc('az_get', { p_store: op.store, p_key: String(op.data.id) }, { attempts: 2, timeout: 20000 });
                                if (there) { op.failed = 'رقم الفاتورة/السجل اتكرر مع جهاز تاني، ما اتحفظش'; await m.putOp(op); continue; }
                            }
                            op.attempted = true; await m.putOp(op);
                            await this.rpc('az_put', { p_store: op.store, p_data: op.data, p_deltas: op.deltas, p_req: op.req, p_absolute: op.absolute }, { attempts: 2, timeout: 25000 });
                        } else if (op.fn === 'del') {
                            await this.rpc('az_delete', { p_store: op.store, p_key: op.key }, { attempts: 2, timeout: 20000 });
                        }
                        await m.delOp(op.seq); done++;
                    } catch (e) {
                        if (e.network) { stop = true; break; }
                        op.failed = String((e && e.message) || e); await m.putOp(op);
                    }
                }
            } finally { this.syncing = false; }
            await this._refreshPending();
            if (done) { try { window.dispatchEvent(new CustomEvent('az-synced', { detail: { done } })); } catch (e) {} }
            if (stop || this.pending) this.syncSoon(20000);
            return done;
        }
        async warm(force) {
            if (!this.me || this.offline) return;
            const m = this._openMirror();
            for (const st of WARM_STORES) {
                try {
                    if (!force && (await m.age(st)) < MIRROR_MAX_AGE) continue;
                    if (await this._hasPending()) return;
                    const rows = await this.rpc('az_get_all', { p_store: st }, { attempts: 1, timeout: 60000 });
                    if (DELTA_FIELDS[st]) rows.forEach(r => this._remember(st, r));
                    await m.replaceAll(st, rows);
                } catch (e) { if (e.network) return; }
                await sleep(200);
            }
        }
        // read: server when possible, otherwise the local copy (which already includes changes waiting to sync)
        async _read(store, online, offlineFn) {
            const m = this._openMirror();
            if (this.offline || await this._hasPending()) { if (!this.offline) this.syncSoon(500); else this._probeSoon(); return offlineFn(m); }
            try { return await online(m); }
            catch (e) {
                if (!e.network) throw e;
                return offlineFn(m);
            }
        }

        // ---------- the Database API used by app.js ----------
        async init() {
            const me = await this.ensureLogin();
            if (!me) {
                if (typeof window.azShowLogin === 'function') await window.azShowLogin(this);
            }
            if (this.me) {
                this._openMirror();
                window.addEventListener('online', () => { this._setOffline(false); this.syncSoon(500); });
                setTimeout(() => { this.sync().catch(() => {}).then(() => this.warm()).catch(() => {}); }, 1500);
                setInterval(() => { if (this.offline) this._probeSoon(); else if (this.pending) this.syncSoon(0); }, 30000);
            }
            return this.me;
        }

        _remember(store, rec) {
            if (rec && typeof rec === 'object' && rec.id !== undefined) this.snap.set(store + ':' + rec.id, JSON.parse(JSON.stringify(rec)));
        }

        async getAll(storeName) {
            return this._read(storeName, async (m) => {
                const rows = await this.rpc('az_get_all', { p_store: storeName }, { attempts: 2, timeout: 60000 });
                if (DELTA_FIELDS[storeName]) rows.forEach(r => this._remember(storeName, r));
                m.replaceAll(storeName, rows);
                return rows;
            }, async (m) => {
                if (!(await m.has(storeName))) { const e = new Error(NET_MSG); e.network = true; throw e; }
                const rows = await m.getAll(storeName);
                if (DELTA_FIELDS[storeName]) rows.forEach(r => this._remember(storeName, r));
                return rows;
            });
        }

        async getById(storeName, id) {
            const key = String(id);
            return this._read(storeName, async (m) => {
                const row = await this.rpc('az_get', { p_store: storeName, p_key: key }, { attempts: 2, timeout: 20000 });
                if (row) { if (DELTA_FIELDS[storeName]) this._remember(storeName, row); m.putRow(storeName, row); }
                return row || undefined;
            }, async (m) => {
                const row = await m.getRow(storeName, key);
                if (row && DELTA_FIELDS[storeName]) this._remember(storeName, row);
                return row;
            });
        }

        async getByDateRange(storeName, startDateStr, endDateStr) {
            const from = startDateStr, to = endDateStr || startDateStr;
            return this._read(storeName, async () => {
                return this.rpc('az_range', { p_store: storeName, p_from: from, p_to: to }, { attempts: 2, timeout: 60000 });
            }, async (m) => {
                if (!(await m.has(storeName))) { const e = new Error(NET_MSG); e.network = true; throw e; }
                const hi = to + String.fromCharCode(65535);
                return (await m.getAll(storeName)).filter(r => { const d = r && r.date != null ? String(r.date) : null; return d !== null && d >= from && d <= hi; })
                    .sort((x, y) => (String(x.date) < String(y.date) ? -1 : String(x.date) > String(y.date) ? 1 : (Number(x.id) || 0) - (Number(y.id) || 0)));
            });
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
            const m = this._openMirror();
            if (!this.offline && !(await this._hasPending())) {
                try {
                    const res = await this.rpc('az_put', { p_store: storeName, p_data: clean, p_deltas: {}, p_req: uuid(), p_absolute: false }, { attempts: 2, timeout: 25000 });
                    if (res && res.data) m.putRow(storeName, res.data);
                    return storeName === 'dayClosures' ? res.key : res.id;
                } catch (e) { if (!e.network) throw e; }
            }
            // no internet: keep it on this phone and send it when the connection is back
            let rec;
            if (storeName === 'dayClosures') rec = clean;
            else { clean.id = this._offId(storeName); rec = clean; }
            if (['invoices', 'customerPayments', 'returns'].includes(storeName) && this.me) {
                rec.createdBy = this.me.username; rec.createdByName = this.me.name;
                if (storeName === 'invoices' && (rec.agentId == null || rec.agentId === '') && this.me.agent_id != null) rec.agentId = String(this.me.agent_id);
            }
            await this._queue('put', storeName, rec, {}, false, undefined, storeName !== 'dayClosures');
            if (DELTA_FIELDS[storeName]) this._remember(storeName, rec);
            return storeName === 'dayClosures' ? rec.date : rec.id;
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
            const m = this._openMirror();
            if (!this.offline && !(await this._hasPending())) {
                try {
                    const res = await this.rpc('az_put', { p_store: storeName, p_data: clean, p_deltas: deltas, p_req: uuid(), p_absolute: !!opts.absolute }, { attempts: 2, timeout: 25000 });
                    if (res && res.data) { if (DELTA_FIELDS[storeName]) this._remember(storeName, res.data); m.putRow(storeName, res.data); }
                    return res.key !== undefined && /^[0-9]+$/.test(res.key) && storeName !== 'dayClosures' ? Number(res.key) : res.key;
                } catch (e) { if (!e.network) throw e; }
            }
            await this._queue('put', storeName, clean, deltas, !!opts.absolute);
            if (DELTA_FIELDS[storeName]) this._remember(storeName, clean);
            return storeName === 'dayClosures' ? clean.date : clean.id;
        }

        async delete(storeName, id) {
            const m = this._openMirror();
            if (!this.offline && !(await this._hasPending())) {
                try {
                    await this.rpc('az_delete', { p_store: storeName, p_key: String(id) }, { attempts: 2, timeout: 20000 });
                    this.snap.delete(storeName + ':' + id);
                    m.delRow(storeName, id);
                    return;
                } catch (e) { if (!e.network) throw e; }
            }
            await this._queue('del', storeName, null, {}, false, id);
            this.snap.delete(storeName + ':' + id);
        }

        async clearAllStores() {
            await this.rpc('az_clear_all', {}, { retry: false });
            this.snap.clear();
            try { const m = this._openMirror(); for (const st of ALL_STORES) await m.replaceAll(st, []); } catch (e) {}
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
            try { const m = this._openMirror(); for (const st of ALL_STORES) await m.replaceAll(st, []); } catch (e) {}
            counts.__failed = failed;
            return counts;
        }
    }

    window.RemoteDatabase = RemoteDatabase;
})();
