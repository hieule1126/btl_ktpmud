const BASE_URL = "http://localhost:3001/api";

export async function api(path, options = {}) {
  const token = localStorage.getItem("warehouse_token");
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Không thể kết nối máy chủ.");
  return data;
}

