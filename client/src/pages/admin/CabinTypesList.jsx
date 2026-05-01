import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CabinTypesList() {
  const [cabinTypes, setCabinTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [disabled, setDisabled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    async function fetchCabinTypes() {
      try {
        setLoading(true);
        const token = localStorage.getItem('adminToken');
        const response = await fetch('/api/admin/cabin-types', {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (cancelled) return;

        if (response.status === 403) {
          setDisabled(true);
          return;
        }
        if (response.status === 401) {
          localStorage.removeItem('adminToken');
          navigate('/login');
          return;
        }
        if (!response.ok) {
          setError('Failed to load cabin types');
          return;
        }

        const data = await response.json();
        const next = (data && data.data && data.data.cabinTypes) ? data.data.cabinTypes : [];
        setCabinTypes(next);
        setError('');
      } catch (e) {
        console.error('Fetch cabin types error:', e);
        setError('Network error loading cabin types');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchCabinTypes();
    return () => { cancelled = true; };
  }, [navigate]);

  function handleRowClick(id) {
    navigate('/admin/cabin-types/' + id);
  }

  if (loading) {
    return (
      <div className="px-4 sm:px-0">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#81887A] mx-auto" />
            <p className="mt-2 text-sm text-gray-600">Loading cabin types...</p>
          </div>
        </div>
      </div>
    );
  }

  if (disabled) {
    return (
      <div className="px-4 sm:px-0">
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-6 text-center">
          <h2 className="text-lg font-semibold text-yellow-800">Multi-unit inventory is disabled</h2>
          <p className="mt-2 text-sm text-yellow-700">
            Enable <code className="font-mono">MULTI_UNIT_ENABLED</code> in your environment configuration to manage cabin types and units.
          </p>
          <button
            type="button"
            onClick={() => navigate('/admin/cabins')}
            className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-[#81887A] hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#81887A]"
          >
            Back to cabins
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 sm:px-0">
        <div className="rounded-md bg-red-50 p-4">
          <div className="text-sm text-red-700">{error}</div>
        </div>
      </div>
    );
  }

  const count = cabinTypes.length;
  const summary = count === 0 ? 'No cabin types found' : ('Showing ' + count + ' cabin type' + (count === 1 ? '' : 's'));

  return (
    <div className="px-4 sm:px-0">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-playfair font-bold text-gray-900">Cabin types</h1>
          <p className="mt-2 text-sm text-gray-700">Manage pooled inventory products and their individual units</p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
          <button
            type="button"
            onClick={() => navigate('/admin/cabin-types/new')}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-[#81887A] hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#81887A]"
          >
            Add cabin type
          </button>
        </div>
      </div>

      <div className="mt-8 space-y-6">
        <div className="flex justify-between items-center">
          <p className="text-sm text-gray-600">{summary}</p>
        </div>

        <div className="overflow-x-auto shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-300" style={{ minWidth: '700px' }}>
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Slug</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Units</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price per night</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {count === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-500">
                    Multi-unit cabin types will appear here once created.
                  </td>
                </tr>
              ) : (
                cabinTypes.map((type) => {
                  const meta = type && type.meta ? type.meta : {};
                  const configured = !!meta.isConfigured;
                  const unitsCount = typeof meta.unitsCount === 'number' ? meta.unitsCount : (meta.unitsCount || 0);
                  const statusLabel = type && type.isActive === false ? 'Inactive' : 'Active';
                  const statusClass = statusLabel === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';

                  return (
                    <tr
                      key={type._id}
                      onClick={() => handleRowClick(type._id)}
                      className="hover:bg-gray-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#81887A] focus:ring-inset"
                      tabIndex={0}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {type.name}
                        {!configured ? (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                            slug not in MULTI_UNIT_TYPES
                          </span>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{type.slug}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{type.location}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{unitsCount}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">€{type.pricePerNight}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ' + statusClass}>
                          {statusLabel}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
