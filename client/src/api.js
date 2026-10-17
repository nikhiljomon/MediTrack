const BASE = import.meta.env.VITE_API_URL || '/api';

export async function api(path, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('token');

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error('Unable to connect to the backend server. Please verify the server is running.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.message ||
      (res.status === 503
        ? 'Database is unavailable. Please ensure MongoDB is running.'
        : res.status === 500
        ? 'Server error occurred. Check the server console for details.'
        : 'Something went wrong. Try again.')
    );
  }
  return data;
}
