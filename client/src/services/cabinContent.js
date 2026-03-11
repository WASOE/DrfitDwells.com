import { cabinAPI } from './api';

const PRIMARY_CABIN_NAMES = ['the cabin', 'bucephalus', 'the cabin (bucephalus)'];

let cabinsPromise = null;

export const fetchCabins = async () => {
  if (!cabinsPromise) {
    cabinsPromise = cabinAPI
      .getAll()
      .then((res) => {
        if (!res?.data?.success) return [];
        return res.data?.data?.cabins || res.data?.cabins || [];
      })
      .catch((error) => {
        cabinsPromise = null;
        throw error;
      });
  }

  return cabinsPromise;
};

export const getPrimaryCabin = async () => {
  const cabins = await fetchCabins();
  return cabins.find(
    (c) => c?.name && PRIMARY_CABIN_NAMES.includes(c.name.trim().toLowerCase())
  ) || cabins[0] || null;
};

export const clearCabinCache = () => {
  cabinsPromise = null;
};
