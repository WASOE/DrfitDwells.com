import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';

const defaultFieldErrors = Object.freeze({});

const CabinTypeEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isNew = !id || id === 'new';

  const [cabinType, setCabinType] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState(defaultFieldErrors);
  const [disabled, setDisabled] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
    location: '',
    hostName: 'Drift & Dwells',
    capacity: 1,
    pricePerNight: 0,
    minNights: 1,
    amenities: [],
    imageUrl: '',
    isActive: true
  });

  const [amenitiesText, setAmenitiesText] = useState('');

  const [units, setUnits] = useState([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitError, setUnitError] = useState('');
  const [unitFormErrors, setUnitFormErrors] = useState(defaultFieldErrors);
  const [newUnitForm, setNewUnitForm] = useState({
    unitNumber: '',
    displayName: '',
    adminNotes: '',
    isActive: true
  });
  const [editingUnitId, setEditingUnitId] = useState(null);
  const [editingUnitForm, setEditingUnitForm] = useState({
    unitNumber: '',
    displayName: '',
    adminNotes: '',
    isActive: true
  });

  const token = () => localStorage.getItem('adminToken');

  const getInputClasses = (field) =>
    `mt-1 block w-full rounded-md shadow-sm sm:text-sm ${fieldErrors[field] ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-[#81887A] focus:border-[#81887A]'}`;

  const clearFieldError = (field) => {
    if (!fieldErrors[field]) return;
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const applyCabinTypeToForm = (type) => {
    if (!type) return;
    setFormData({
      name: type.name || '',
      slug: type.slug || '',
      description: type.description || '',
      location: type.location || '',
      hostName: type.hostName || 'Drift & Dwells',
      capacity: type.capacity || 1,
      pricePerNight: type.pricePerNight || 0,
      minNights: type.minNights || 1,
      amenities: type.amenities || [],
      imageUrl: type.imageUrl || '',
      isActive: type.isActive !== false
    });
    setAmenitiesText((type.amenities || []).join('\n'));
  };

  const loadUnits = async (typeId) => {
    try {
      setUnitsLoading(true);
      setUnitError('');
      const response = await fetch(`/api/admin/cabin-types/${typeId}/units`, {
        headers: {
          'Authorization': `Bearer ${token()}`
        }
      });
      if (response.status === 403) {
        setDisabled(true);
        setUnits([]);
        return;
      }
      if (response.status === 401) {
        localStorage.removeItem('adminToken');
        navigate('/admin/login');
        return;
      }
      if (!response.ok) {
        setUnitError('Failed to load units');
        return;
      }
      const data = await response.json();
      setUnits(data.data?.units || []);
    } catch (err) {
      console.error('Load units error:', err);
      setUnitError('Network error loading units');
    } finally {
      setUnitsLoading(false);
    }
  };

  useEffect(() => {
    if (isNew) {
      setCabinType(null);
      setLoading(false);
      setError('');
      return;
    }

    const fetchCabinType = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/admin/cabin-types/${id}`, {
          headers: {
            'Authorization': `Bearer ${token()}`
          }
        });

        if (response.status === 403) {
          setDisabled(true);
          setLoading(false);
          return;
        }

        if (response.status === 401) {
          localStorage.removeItem('adminToken');
          navigate('/admin/login');
          return;
        }

        if (!response.ok) {
          setError('Failed to load cabin type');
          setLoading(false);
          return;
        }

        const data = await response.json();
        const type = data.data?.cabinType;
        setCabinType(type);
        applyCabinTypeToForm(type);
        await loadUnits(type._id);
      } catch (err) {
        console.error('Fetch cabin type error:', err);
        setError('Network error loading cabin type');
      } finally {
        setLoading(false);
      }
    };

    fetchCabinType();
  }, [id, isNew, navigate]);

  useEffect(() => {
    if (location.state?.successMessage) {
      setSaveMessage(location.state.successMessage);
      setTimeout(() => setSaveMessage(''), 3000);
      navigate(location.pathname.replace(/\/$/, ''), { replace: true, state: {} });
    }
  }, [location, navigate]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    clearFieldError(field);
  };

  const handleAmenitiesChange = (text) => {
    setAmenitiesText(text);
    const items = text
      .split('\n')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    setFormData((prev) => ({ ...prev, amenities: items }));
    clearFieldError('amenities');
  };

  const buildFieldErrors = (errors = []) => {
    const next = {};
    errors.forEach((err) => {
      const field = err.field || err.param || 'root';
      const message = err.message || err.msg || 'Invalid value';
      if (!next[field]) {
        next[field] = message;
      }
    });
    return next;
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage('');
    setError('');
    setFieldErrors(defaultFieldErrors);

    try {
      const payload = {
        ...formData,
        amenities: (formData.amenities || []).map((item) => item.trim()).filter(Boolean),
        slug: formData.slug.trim().toLowerCase()
      };

      const endpoint = isNew ? '/api/admin/cabin-types' : `/api/admin/cabin-types/${id}`;
      const method = isNew ? 'POST' : 'PATCH';

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token()}`
        },
        body: JSON.stringify(payload)
      });

      if (response.status === 403) {
        setDisabled(true);
        return;
      }

      if (response.status === 401) {
        localStorage.removeItem('adminToken');
        navigate('/admin/login');
        return;
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFieldErrors(buildFieldErrors(data.errors));
        setError(data.message || 'Failed to save cabin type');
        return;
      }

      const updatedType = data.data?.cabinType;

      if (isNew) {
        if (updatedType?._id) {
          navigate(`/admin/cabin-types/${updatedType._id}`, {
            state: { successMessage: 'Cabin type created successfully' }
          });
          return;
        }
      } else {
        if (updatedType) {
          setCabinType(updatedType);
          applyCabinTypeToForm(updatedType);
        }
        setSaveMessage('Cabin type updated successfully');
        setTimeout(() => setSaveMessage(''), 3000);
      }
    } catch (err) {
      console.error('Save cabin type error:', err);
      setError('Failed to save cabin type');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateUnit = async () => {
    setUnitFormErrors(defaultFieldErrors);
    setUnitError('');

    try {
      const response = await fetch(`/api/admin/cabin-types/${cabinType._id}/units`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token()}`
        },
        body: JSON.stringify(newUnitForm)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setUnitFormErrors(buildFieldErrors(data.errors));
        setUnitError(data.message || 'Failed to add unit');
        return;
      }

      setNewUnitForm({ unitNumber: '', displayName: '', adminNotes: '', isActive: true });
      await loadUnits(cabinType._id);
    } catch (err) {
      console.error('Create unit error:', err);
      setUnitError('Failed to add unit');
    }
  };

  const handleStartUnitEdit = (unit) => {
    setEditingUnitId(unit._id);
    setEditingUnitForm({
      unitNumber: unit.unitNumber || '',
      displayName: unit.displayName || '',
      adminNotes: unit.adminNotes || '',
      isActive: unit.isActive !== false
    });
    setUnitFormErrors(defaultFieldErrors);
  };

  const handleUpdateUnit = async () => {
    setUnitFormErrors(defaultFieldErrors);
    setUnitError('');

    try {
      const response = await fetch(`/api/admin/cabin-types/units/${editingUnitId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token()}`
        },
        body: JSON.stringify(editingUnitForm)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setUnitFormErrors(buildFieldErrors(data.errors));
        setUnitError(data.message || 'Failed to update unit');
        return;
      }

      setEditingUnitId(null);
      await loadUnits(cabinType._id);
    } catch (err) {
      console.error('Update unit error:', err);
      setUnitError('Failed to update unit');
    }
  };

  const handleCancelUnitEdit = () => {
    setEditingUnitId(null);
    setEditingUnitForm({ unitNumber: '', displayName: '', adminNotes: '', isActive: true });
    setUnitFormErrors(defaultFieldErrors);
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-0">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#81887A] mx-auto"></div>
            <p className="mt-2 text-sm text-gray-600">Loading cabin type...</p>
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
            Enable <code className="font-mono">MULTI_UNIT_ENABLED</code> to manage cabin types and units.
          </p>
          <button
            onClick={() => navigate('/admin/cabins')}
            className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-[#81887A] hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#81887A]"
          >
            Back to cabins
          </button>
        </div>
      </div>
    );
  }

  if (error && !cabinType && !isNew) {
    return (
      <div className="px-4 sm:px-0">
        <div className="rounded-md bg-red-50 p-4">
          <div className="text-sm text-red-700">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0">
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <button
              onClick={() => navigate('/admin/cabin-types')}
              className="mb-4 text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back to Cabin types
            </button>
            <h1 className="text-2xl font-playfair font-bold text-gray-900">
              {isNew ? 'New Cabin Type' : 'Edit Cabin Type'}
            </h1>
            <p className="mt-2 text-sm text-gray-700">
              {isNew ? 'Create a pooled inventory product and configure its units.' : (cabinType?.name || '')}
            </p>
          </div>
          <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
            <div className="flex items-center gap-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-[#81887A] hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#81887A] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : (isNew ? 'Create cabin type' : 'Save changes')}
              </button>
              {saveMessage && (
                <span className="text-sm text-green-600">{saveMessage}</span>
              )}
            </div>
          </div>
        </div>

        {(!isNew && cabinType?.meta?.isConfigured === false) && (
          <div className="mt-4 rounded-md bg-yellow-50 p-4 border border-yellow-200">
            <p className="text-sm text-yellow-800 font-medium">
              This cabin type’s slug is not listed in <code className="font-mono">MULTI_UNIT_TYPES</code>. Guests will not see pooled availability until it is added to the configuration.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-4">
            <div className="text-sm text-red-700">{error}</div>
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 xl:grid-cols-2 gap-8">
          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">Basic Information</h3>
              <p className="mt-1 text-sm text-gray-500">Provide the core details that describe this multi-unit product.</p>
            </div>
            <div className="border-t border-gray-200 px-4 py-5 sm:px-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  className={getInputClasses('name')}
                  required
                />
                {fieldErrors.name && (
                  <p className="mt-1 text-sm text-red-600">{fieldErrors.name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Slug</label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) => handleInputChange('slug', e.target.value)}
                  className={getInputClasses('slug')}
                  placeholder="a-frame"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  Must match the slug configured in <code className="font-mono">MULTI_UNIT_TYPES</code>.
                </p>
                {fieldErrors.slug && (
                  <p className="mt-1 text-sm text-red-600">{fieldErrors.slug}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  rows={4}
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  className={`${getInputClasses('description')} resize-none`}
                  placeholder="Describe the experience, amenities, and unique aspects of this cabin type"
                  required
                />
                {fieldErrors.description && (
                  <p className="mt-1 text-sm text-red-600">{fieldErrors.description}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Location</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => handleInputChange('location', e.target.value)}
                  className={getInputClasses('location')}
                  required
                />
                {fieldErrors.location && (
                  <p className="mt-1 text-sm text-red-600">{fieldErrors.location}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Host name</label>
                <input
                  type="text"
                  value={formData.hostName}
                  onChange={(e) => handleInputChange('hostName', e.target.value)}
                  className={getInputClasses('hostName')}
                  placeholder="Drift & Dwells"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Capacity per unit</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.capacity}
                    onChange={(e) => handleInputChange('capacity', parseInt(e.target.value) || 1)}
                    className={getInputClasses('capacity')}
                    required
                  />
                  {fieldErrors.capacity && (
                    <p className="mt-1 text-sm text-red-600">{fieldErrors.capacity}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Price per night (€)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.pricePerNight}
                    onChange={(e) => handleInputChange('pricePerNight', parseFloat(e.target.value) || 0)}
                    className={getInputClasses('pricePerNight')}
                    required
                  />
                  {fieldErrors.pricePerNight && (
                    <p className="mt-1 text-sm text-red-600">{fieldErrors.pricePerNight}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Minimum nights</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.minNights}
                    onChange={(e) => handleInputChange('minNights', parseInt(e.target.value) || 1)}
                    className={getInputClasses('minNights')}
                    required
                  />
                  {fieldErrors.minNights && (
                    <p className="mt-1 text-sm text-red-600">{fieldErrors.minNights}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Cover image URL</label>
                <input
                  type="url"
                  value={formData.imageUrl}
                  onChange={(e) => handleInputChange('imageUrl', e.target.value)}
                  className={getInputClasses('imageUrl')}
                  placeholder="https://example.com/cabin.jpg"
                  required
                />
                {fieldErrors.imageUrl && (
                  <p className="mt-1 text-sm text-red-600">{fieldErrors.imageUrl}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Amenities</label>
                <textarea
                  rows={4}
                  value={amenitiesText}
                  onChange={(e) => handleAmenitiesChange(e.target.value)}
                  className={`${getInputClasses('amenities')} resize-none`}
                  placeholder="Sauna\nPrivate deck\nMountain view"
                />
                <p className="mt-1 text-xs text-gray-500">Enter one amenity per line.</p>
                {fieldErrors.amenities && (
                  <p className="mt-1 text-sm text-red-600">{fieldErrors.amenities}</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="isActive"
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => handleInputChange('isActive', e.target.checked)}
                  className="h-4 w-4 text-[#81887A] focus:ring-[#81887A] border-gray-300 rounded"
                />
                <label htmlFor="isActive" className="text-sm text-gray-700">
                  Cabin type is active
                </label>
              </div>
            </div>
          </div>

          {!isNew && (
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
                <div>
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Units</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Manage the individual units that make up this cabin type.
                  </p>
                </div>
              </div>
              <div className="border-t border-gray-200 px-4 py-5 sm:px-6 space-y-6">
                {unitError && (
                  <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{unitError}</div>
                )}

                <div className="border border-gray-200 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-900">Add unit</h4>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Unit code *</label>
                      <input
                        type="text"
                        value={newUnitForm.unitNumber}
                        onChange={(e) => setNewUnitForm((prev) => ({ ...prev, unitNumber: e.target.value }))}
                        className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${unitFormErrors.unitNumber ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-[#81887A] focus:border-[#81887A]'}`}
                      />
                      {unitFormErrors.unitNumber && (
                        <p className="mt-1 text-xs text-red-600">{unitFormErrors.unitNumber}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Display name</label>
                      <input
                        type="text"
                        value={newUnitForm.displayName}
                        onChange={(e) => setNewUnitForm((prev) => ({ ...prev, displayName: e.target.value }))}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm sm:text-sm focus:ring-[#81887A] focus:border-[#81887A]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Admin notes</label>
                      <input
                        type="text"
                        value={newUnitForm.adminNotes}
                        onChange={(e) => setNewUnitForm((prev) => ({ ...prev, adminNotes: e.target.value }))}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm sm:text-sm focus:ring-[#81887A] focus:border-[#81887A]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Status</label>
                      <select
                        value={newUnitForm.isActive ? 'active' : 'inactive'}
                        onChange={(e) => setNewUnitForm((prev) => ({ ...prev, isActive: e.target.value === 'active' }))}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm sm:text-sm focus:ring-[#81887A] focus:border-[#81887A]"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={handleCreateUnit}
                      className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-[#81887A] hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#81887A]"
                    >
                      Add unit
                    </button>
                  </div>
                </div>

                <div>
                  {unitsLoading ? (
                    <div className="text-center py-8 text-sm text-gray-500">Loading units...</div>
                  ) : units.length === 0 ? (
                    <div className="text-sm text-gray-500">No units added yet. Create your first unit above.</div>
                  ) : (
                    <div className="overflow-hidden border border-gray-200 rounded-lg">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Display name</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {units.map((unit) => (
                            <tr key={unit._id} className="align-top">
                              <td className="px-4 py-3 text-sm text-gray-900">
                                {editingUnitId === unit._id ? (
                                  <input
                                    type="text"
                                    value={editingUnitForm.unitNumber}
                                    onChange={(e) => setEditingUnitForm((prev) => ({ ...prev, unitNumber: e.target.value }))}
                                    className={`block w-full rounded-md shadow-sm sm:text-sm ${unitFormErrors.unitNumber ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-[#81887A] focus:border-[#81887A]'}`}
                                  />
                                ) : (
                                  <span className="font-medium">{unit.unitNumber}</span>
                                )}
                                {editingUnitId === unit._id && unitFormErrors.unitNumber && (
                                  <p className="mt-1 text-xs text-red-600">{unitFormErrors.unitNumber}</p>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-900">
                                {editingUnitId === unit._id ? (
                                  <input
                                    type="text"
                                    value={editingUnitForm.displayName}
                                    onChange={(e) => setEditingUnitForm((prev) => ({ ...prev, displayName: e.target.value }))}
                                    className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm focus:ring-[#81887A] focus:border-[#81887A]"
                                  />
                                ) : (
                                  unit.displayName || '—'
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-900">
                                {editingUnitId === unit._id ? (
                                  <textarea
                                    rows={2}
                                    value={editingUnitForm.adminNotes}
                                    onChange={(e) => setEditingUnitForm((prev) => ({ ...prev, adminNotes: e.target.value }))}
                                    className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm focus:ring-[#81887A] focus:border-[#81887A]"
                                  />
                                ) : (
                                  unit.adminNotes || '—'
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                {editingUnitId === unit._id ? (
                                  <select
                                    value={editingUnitForm.isActive ? 'active' : 'inactive'}
                                    onChange={(e) => setEditingUnitForm((prev) => ({ ...prev, isActive: e.target.value === 'active' }))}
                                    className="block w-full border-gray-300 rounded-md shadow-sm sm:text-sm focus:ring-[#81887A] focus:border-[#81887A]"
                                  >
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                  </select>
                                ) : (
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                    unit.isActive !== false
                                      ? 'bg-green-100 text-green-800'
                                      : 'bg-gray-100 text-gray-800'
                                  }`}>
                                    {unit.isActive !== false ? 'Active' : 'Inactive'}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right text-sm">
                                {editingUnitId === unit._id ? (
                                  <div className="flex justify-end gap-2">
                                    <button
                                      onClick={handleUpdateUnit}
                                      className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-[#81887A] hover:bg-[#707668]"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={handleCancelUnitEdit}
                                      className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 hover:bg-gray-50"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => handleStartUnitEdit(unit)}
                                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-[#81887A] hover:bg-[#707668]"
                                  >
                                    Edit
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
    </div>
  );
};

export default CabinTypeEdit;
