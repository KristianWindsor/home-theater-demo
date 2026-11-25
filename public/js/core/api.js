// Server API + live events.

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch { /* not json */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  library: () => req('GET', '/api/library'),
  item: (id) => req('GET', `/api/item/${id}`),
  score: (id) => req('GET', `/api/score/${id}`),
  analyze: (id) => req('POST', `/api/analyze/${id}`),
  rescan: () => req('POST', '/api/rescan'),
  saveScenes: (id, scenes) => req('PUT', `/api/scenes/${id}`, { scenes }),
  resetScenes: (id) => req('DELETE', `/api/scenes/${id}`),
  thumb: (id, t, w = 480) => `/api/thumb/${id}?t=${Math.round(t * 10) / 10}&w=${w}`,
};

/** Subscribe to server-sent events. handlers: { analysis(data), library(data) } */
export function events(handlers) {
  let es;
  const open = () => {
    es = new EventSource('/api/events');
    for (const [name, fn] of Object.entries(handlers)) {
      es.addEventListener(name, (e) => {
        try {
          fn(JSON.parse(e.data));
        } catch (err) {
          console.warn('[events]', err);
        }
      });
    }
  };
  open();
  return () => es && es.close();
}
