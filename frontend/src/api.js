import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("domain_monitor_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const register = (data) => api.post("/auth/register", data);
export const login = (data) => api.post("/auth/login", data);
export const getMe = () => api.get("/auth/me");
export const forgotPassword = (email) => api.post("/auth/forgot-password", { email });
export const resetPassword = (token, password) => api.post("/auth/reset-password", { token, password });

export const guestCheck = (domains) => api.post("/guest/check", { domains });
export const guestUploadExcel = (file) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/guest/upload", form);
};

export const getDashboard = () => api.get("/dashboard");
export const getDomains = () => api.get("/domains");
export const getRecentHistory = () => api.get("/history/recent");
export const getHistory = (id) => api.get(`/domains/${id}/history`);
export const addDomain = (domain) => api.post("/domains", { domain });
export const updateDomain = (id, data) => api.put(`/domains/${id}`, data);
export const toggleDomain = (id) => api.patch(`/domains/${id}/toggle`);
export const deleteDomain = (id) => api.delete(`/domains/${id}`);
export const checkDomain = (id) => api.post(`/domains/${id}/check`);
export const checkAllDomains = () => api.post("/domains/check-all");
export const checkAllGroupDomains = (groupId) => api.post(`/groups/${groupId}/check-all`);
export const uploadExcel = (file) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/domains/upload", form);
};

export const getGroups = () => api.get("/groups");
export const getGroup = (id) => api.get(`/groups/${id}`);
export const createGroup = (data) => api.post("/groups", data);
export const joinGroup = (joinCode) => api.post("/groups/join", { joinCode });
export const addGroupMember = (id, data) => api.post(`/groups/${id}/members`, data);
export const updateGroupMember = (groupId, userId, data) => api.patch(`/groups/${groupId}/members/${userId}`, data);
export const removeGroupMember = (groupId, userId) => api.delete(`/groups/${groupId}/members/${userId}`);
export const addDomainsToGroup = (groupId, domainIds) => api.post(`/groups/${groupId}/domains`, { domainIds });
export const addDomainToGroup = (groupId, domain) => api.post(`/groups/${groupId}/domain`, { domain });
export const uploadGroupExcel = (groupId, file) => {
  const form = new FormData();
  form.append("file", file);
  return api.post(`/groups/${groupId}/upload`, form);
};
export const removeDomainFromGroup = (groupId, domainId) => api.delete(`/groups/${groupId}/domains/${domainId}`);
export const reviewEditRequest = (groupId, requestId, decision) => api.post(`/groups/${groupId}/edit-requests/${requestId}`, { decision });
export const reviewDomainAddRequest = (groupId, requestId, decision) => api.post(`/groups/${groupId}/domain-add-requests/${requestId}`, { decision });
export const requestGroupPermission = (groupId, permission, message = "") => api.post(`/groups/${groupId}/permission-requests`, { permission, message });
export const reviewGroupPermissionRequest = (groupId, requestId, decision) => api.post(`/groups/${groupId}/permission-requests/${requestId}`, { decision });

export const getDashboards = () => api.get("/dashboards");
export const createDashboard = (data) => api.post("/dashboards", data);
export const getDashboardById = (id) => api.get(`/dashboards/${id}`);
export const deleteDashboard = (id) => api.delete(`/dashboards/${id}`);

export const getAdminStats = () => api.get("/admin/stats");
export const getAdminUsers = () => api.get("/admin/users");
export const updateAdminUser = (id, isAdmin) => api.patch(`/admin/users/${id}`, { isAdmin });
export const deleteAdminUser = (id) => api.delete(`/admin/users/${id}`);
export const getAdminGroups = () => api.get("/admin/groups");
export const deleteAdminGroup = (id) => api.delete(`/admin/groups/${id}`);
export const getAdminDomains = () => api.get("/admin/domains");
export const getAdminContacts = () => api.get("/admin/contacts");
export const sendContactMessage = (data) => api.post("/contact", data);
export const deleteAdminDomain = (id) => api.delete(`/admin/domains/${id}`);

export default api;
