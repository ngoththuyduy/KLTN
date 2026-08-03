import { auth } from './firebase';

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = await auth.currentUser?.getIdToken();
  const headers = new Headers(init.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else {
    try {
      const activeUser = JSON.parse(sessionStorage.getItem('sales_intel_active_demo_user') || 'null');
      if (activeUser?.id && String(activeUser.id).startsWith('demo_')) {
        headers.set('X-Demo-User', activeUser.id);
      }
    } catch {
      // Ignore malformed demo session metadata.
    }
  }

  return fetch(input, {
    ...init,
    headers
  });
}
