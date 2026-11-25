const DB_NAME = 'AbuZamelDB';
const DB_VERSION = 13;

class Database {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error('Database error:', event.target.error);
                reject(event.target.error);
            };

            request.onblocked = () => {
                alert('يرجى إغلاق كافة التبويبات المفتوحة للبرنامج لإتمام التحديث.');
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const tx = event.target.transaction;

                const ensureStore = (name, opts) => {
                    return db.objectStoreNames.contains(name) 
                        ? tx.objectStore(name) 
                        : db.createObjectStore(name, opts);
                };

                const ensureIndex = (store, indexName, keyPath) => {
                    if (!store.indexNames.contains(indexName)) {
                        store.createIndex(indexName, keyPath, { unique: false });
                    }
                };

                ensureStore('products', { keyPath: 'id', autoIncrement: true });
                ensureStore('customers', { keyPath: 'id', autoIncrement: true });
                
                const invoicesStore = ensureStore('invoices', { keyPath: 'id', autoIncrement: true });
                ensureIndex(invoicesStore, 'date', 'date');
                ensureIndex(invoicesStore, 'agentId', 'agentId');

                ensureStore('agents', { keyPath: 'id', autoIncrement: true });

                const expensesStore = ensureStore('expenses', { keyPath: 'id', autoIncrement: true });
                ensureIndex(expensesStore, 'date', 'date');

                const inventoryStore = ensureStore('inventoryLog', { keyPath: 'id', autoIncrement: true });
                ensureIndex(inventoryStore, 'date', 'date');
                ensureIndex(inventoryStore, 'productId', 'productId');

                ensureStore('users', { keyPath: 'id', autoIncrement: true });

                const settlementsStore = ensureStore('settlements', { keyPath: 'id', autoIncrement: true });
                ensureIndex(settlementsStore, 'date', 'date');

                const returnsStore = ensureStore('returns', { keyPath: 'id', autoIncrement: true });
                ensureIndex(returnsStore, 'date', 'date');

                ensureStore('suppliers', { keyPath: 'id', autoIncrement: true });

                const purchasesStore = ensureStore('purchases', { keyPath: 'id', autoIncrement: true });
                ensureIndex(purchasesStore, 'date', 'date');

                const auditsStore = ensureStore('audits', { keyPath: 'id', autoIncrement: true });
                ensureIndex(auditsStore, 'date', 'date');

                ensureStore('dayClosures', { keyPath: 'date' });

                const cPaymentsStore = ensureStore('customerPayments', { keyPath: 'id', autoIncrement: true });
                ensureIndex(cPaymentsStore, 'date', 'date');

                const sPaymentsStore = ensureStore('supplierPayments', { keyPath: 'id', autoIncrement: true });
                ensureIndex(sPaymentsStore, 'date', 'date');
            };
        });
    }

    async add(storeName, data) {
        return this.runTransaction(storeName, 'readwrite', (store) => store.add(data));
    }

    async getAll(storeName) {
        return this.runTransaction(storeName, 'readonly', (store) => store.getAll());
    }

    async getByIndex(storeName, indexName, keyRange) {
        return this.runTransaction(storeName, 'readonly', (store) => {
            const index = store.index(indexName);
            return index.getAll(keyRange);
        });
    }

    async getByDateRange(storeName, startDateStr, endDateStr) {
        // Safely bounds string comparisons like '2026-03-01' to '2026-03-31\uffff'
        const range = IDBKeyRange.bound(startDateStr, (endDateStr || startDateStr) + '\uffff');
        
        if (storeName === 'dayClosures') {
            return this.runTransaction(storeName, 'readonly', (store) => store.getAll(range));
        }
        
        return this.getByIndex(storeName, 'date', range);
    }

    async getById(storeName, id) {
        return this.runTransaction(storeName, 'readonly', (store) => store.get(id));
    }

    async update(storeName, data) {
        return this.runTransaction(storeName, 'readwrite', (store) => store.put(data));
    }

    async delete(storeName, id) {
        return this.runTransaction(storeName, 'readwrite', (store) => store.delete(id));
    }

    async clearAllStores() {
        const stores = ['products', 'customers', 'invoices', 'agents', 'expenses', 'inventoryLog', 'users', 'settlements', 'returns', 'suppliers', 'purchases', 'audits', 'dayClosures', 'customerPayments', 'supplierPayments'];
        for (const storeName of stores) {
            await this.runTransaction(storeName, 'readwrite', (store) => store.clear());
        }
    }

    async runTransaction(storeName, mode, callback) {
        const transaction = this.db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = callback(store);

        return new Promise((resolve, reject) => {
            let result;
            request.onsuccess = () => {
                result = request.result;
            };
            request.onerror = () => reject(request.error);

            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error || request.error);
            transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
        });
    }

    async getPaginated(storeName, limit = 50, offset = 0, direction = 'next') {
        const results = [];
        let skipped = 0;
        let count = 0;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.openCursor(null, direction);

            let advanced = false;
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor || results.length >= limit) {
                    resolve(results);
                    return;
                }

                if (offset > 0 && !advanced) {
                    advanced = true;
                    cursor.advance(offset);
                    return;
                }

                results.push(cursor.value);
                cursor.continue();
            };
            request.onerror = () => reject(request.error);
        });
    }
}

const db = new Database();
