import axios from 'axios';

export async function uploadCabinImage(cabinId, file, token) {
  const fd = new FormData();
  fd.append('file', file);
  return axios.post(`/api/admin/cabins/${cabinId}/images`, fd, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
  });
}

export function updateCabinImage(cabinId, imageId, payload, token) {
  return axios.patch(`/api/admin/cabins/${cabinId}/images/${imageId}`, payload, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
}

export function reorderCabinImages(cabinId, order, token) {
  return axios.patch(
    `/api/admin/cabins/${cabinId}/images/reorder`,
    { order },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
}

export function deleteCabinImage(cabinId, imageId, token) {
  return axios.delete(`/api/admin/cabins/${cabinId}/images/${imageId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
}

export function batchUpdateCabinImages(cabinId, updates, token) {
  return axios.patch(`/api/admin/cabins/${cabinId}/images/batch`, { updates }, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
}

