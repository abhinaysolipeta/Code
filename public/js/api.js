/* Thin fetch wrapper. Server errors arrive as {error, field}; surface both so
 * forms can highlight the offending input. */

export class ApiError extends Error {
  constructor(message, status, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    const text = await res.text();
    if (!res.ok) throw new ApiError(text || res.statusText, res.status);
    return text;
  }

  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error ?? res.statusText, res.status, data.field);
  return data;
}

const qs = (params = {}) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, v);
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const api = {
  state: () => request('GET', '/api/state'),
  report: (month, trend) => request('GET', `/api/report${qs({ month, trend })}`),

  createAccount: (body) => request('POST', '/api/accounts', body),
  updateAccount: (id, body) => request('PATCH', `/api/accounts/${id}`, body),
  deleteAccount: (id) => request('DELETE', `/api/accounts/${id}`),

  snapshots: (month) => request('GET', `/api/snapshots${qs({ month })}`),
  saveSnapshot: (body) => request('PUT', '/api/snapshots', body),
  saveSnapshots: (month, entries) => request('POST', '/api/snapshots/bulk', { month, entries }),

  transactions: (params) => request('GET', `/api/transactions${qs(params)}`),
  createTransaction: (body) => request('POST', '/api/transactions', body),
  updateTransaction: (id, body) => request('PATCH', `/api/transactions/${id}`, body),
  deleteTransaction: (id) => request('DELETE', `/api/transactions/${id}`),
  importTransactions: (body) => request('POST', '/api/transactions/import', body),

  bills: () => request('GET', '/api/bills'),
  createBill: (body) => request('POST', '/api/bills', body),
  updateBill: (id, body) => request('PATCH', `/api/bills/${id}`, body),
  deleteBill: (id) => request('DELETE', `/api/bills/${id}`),

  markPaid: (body) => request('PUT', '/api/payments', body),
  unmarkPaid: (month, source, refId) => request('DELETE', `/api/payments${qs({ month, source, refId })}`),

  categories: () => request('GET', '/api/categories'),
  createCategory: (body) => request('POST', '/api/categories', body),
  updateCategory: (id, body) => request('PATCH', `/api/categories/${id}`, body),
  deleteCategory: (id) => request('DELETE', `/api/categories/${id}`),

  updateSettings: (body) => request('PATCH', '/api/settings', body),
  importBackup: (db) => request('POST', '/api/import', db),
};
