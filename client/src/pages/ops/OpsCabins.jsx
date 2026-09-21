import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsInlineError from '../../ops/primitives/OpsInlineError';
import OpsBadge from '../../ops/primitives/OpsBadge';
import {
  buildExperienceKey,
  formatDateOnlyForOps,
  normalizeMediaSrc,
  thumbInitials
} from './cabins/cabinOpsUtils.js';
import CabinMediaManager from './cabins/CabinMediaManager.jsx';
import OpsReadOnlyDetailSection from './cabins/OpsReadOnlyDetailSection.jsx';
import ArchiveCabinModal from './cabins/ArchiveCabinModal.jsx';
import CabinUnitsEditor from './cabins/CabinUnitsEditor.jsx';
import CabinContentEditor from './cabins/CabinContentEditor.jsx';
import CabinArrivalEditor from './cabins/CabinArrivalEditor.jsx';
import CabinTransportEditor from './cabins/CabinTransportEditor.jsx';
import CabinOccupancyPricingEditor from './cabins/CabinOccupancyPricingEditor.jsx';
import CabinExperiencesEditor from './cabins/CabinExperiencesEditor.jsx';
import './OpsCabinDetail.css';

const BACK = { to: '/ops/cabins', label: 'Back to cabins' };

function DetailHeader({ title, meta, actions }) {
  return <OpsPageHeader back={BACK} title={title} meta={meta} actions={actions} />;
}

function Fact({ label, children, numeric = false, wide = false }) {
  return (
    <div className={`ops-cd-fact${wide ? ' ops-cd-fact--wide' : ''}`}>
      <dt className="ops-cd-fact__label">{label}</dt>
      <dd className={`ops-cd-fact__value${numeric ? ' ops-cd-fact__value--numeric' : ''}`}>{children}</dd>
    </div>
  );
}

export default function OpsCabinDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigateDetail = useNavigate();
  const [showCreatedBanner, setShowCreatedBanner] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contentEditOpen, setContentEditOpen] = useState(false);
  const [contentEditBusy, setContentEditBusy] = useState(false);
  const [contentEditError, setContentEditError] = useState('');
  const [contentEditSuccess, setContentEditSuccess] = useState('');
  const [arrivalEditOpen, setArrivalEditOpen] = useState(false);
  const [arrivalEditBusy, setArrivalEditBusy] = useState(false);
  const [arrivalEditError, setArrivalEditError] = useState('');
  const [arrivalEditSuccess, setArrivalEditSuccess] = useState('');
  const [cutoffsEditOpen, setCutoffsEditOpen] = useState(false);
  const [cutoffsEditBusy, setCutoffsEditBusy] = useState(false);
  const [cutoffsEditError, setCutoffsEditError] = useState('');
  const [cutoffsEditSuccess, setCutoffsEditSuccess] = useState('');
  const [transportOptionsEditOpen, setTransportOptionsEditOpen] = useState(false);
  const [transportOptionsEditBusy, setTransportOptionsEditBusy] = useState(false);
  const [transportOptionsEditError, setTransportOptionsEditError] = useState('');
  const [transportOptionsEditSuccess, setTransportOptionsEditSuccess] = useState('');
  const [occupancyEditOpen, setOccupancyEditOpen] = useState(false);
  const [occupancyEditBusy, setOccupancyEditBusy] = useState(false);
  const [occupancyEditError, setOccupancyEditError] = useState('');
  const [occupancyEditSuccess, setOccupancyEditSuccess] = useState('');
  const [pricingEditOpen, setPricingEditOpen] = useState(false);
  const [pricingEditBusy, setPricingEditBusy] = useState(false);
  const [pricingEditError, setPricingEditError] = useState('');
  const [pricingEditSuccess, setPricingEditSuccess] = useState('');
  const [experiencesEditOpen, setExperiencesEditOpen] = useState(false);
  const [experiencesEditBusy, setExperiencesEditBusy] = useState(false);
  const [experiencesEditError, setExperiencesEditError] = useState('');
  const [experiencesEditSuccess, setExperiencesEditSuccess] = useState('');
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveConfirmName, setArchiveConfirmName] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [contentEditForm, setContentEditForm] = useState({
    name: '',
    description: '',
    hostName: '',
    i18nBgName: '',
    i18nBgLocation: '',
    i18nBgDescription: '',
    avgResponseTimeHours: '',
    highlightsText: '',
    superhostEnabled: false,
    superhostLabel: 'Superhost',
    guestFavoriteEnabled: false,
    guestFavoriteLabel: 'Guest favorite'
  });
  const [arrivalEditForm, setArrivalEditForm] = useState({
    location: '',
    geoLatitude: '',
    geoLongitude: '',
    geoZoom: '11',
    meetingLabel: '',
    meetingGoogleMapsUrl: '',
    meetingWhat3words: '',
    meetingLat: '',
    meetingLng: '',
    arrivalWindowDefault: '',
    arrivalGuideUrl: '',
    safetyNotes: '',
    emergencyContact: '',
    packingListText: ''
  });
  const [cutoffsEditRows, setCutoffsEditRows] = useState([]);
  const [transportOptionsEditRows, setTransportOptionsEditRows] = useState([]);
  const [occupancyEditForm, setOccupancyEditForm] = useState({
    capacity: '',
    minNights: ''
  });
  const [pricingEditForm, setPricingEditForm] = useState({
    pricePerNight: ''
  });
  const [experiencesEditRows, setExperiencesEditRows] = useState([]);
  const detailRequestSeq = useRef(0);

  const loadDetail = useCallback(async () => {
    const requestSeq = detailRequestSeq.current + 1;
    detailRequestSeq.current = requestSeq;
    setLoading(true);
    setError('');
    try {
      const resp = await opsReadAPI.cabinDetail(id);
      if (detailRequestSeq.current !== requestSeq) return;
      setData(resp.data?.data || null);
    } catch (err) {
      if (detailRequestSeq.current !== requestSeq) return;
      setError(err?.response?.data?.message || 'Failed to load cabin');
    } finally {
      if (detailRequestSeq.current === requestSeq) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
    return () => {
      detailRequestSeq.current += 1;
    };
  }, [loadDetail]);

  useEffect(() => {
    if (location.state?.opsFlash !== 'cabin-created') return;
    setShowCreatedBanner(true);
    navigateDetail(
      { pathname: location.pathname, search: location.search || '' },
      { replace: true, state: {} }
    );
  }, [location.pathname, location.search, location.state?.opsFlash, navigateDetail]);

  const handleArchiveSubmit = async (e) => {
    e.preventDefault();
    setArchiveError('');
    const r = archiveReason.trim();
    if (r.length < 8) {
      setArchiveError('Reason must be at least 8 characters.');
      return;
    }
    setArchiveBusy(true);
    try {
      await opsWriteAPI.archiveCabin(id, {
        reason: r,
        confirmName: archiveConfirmName.trim()
      });
      setArchiveModalOpen(false);
      navigateDetail('/ops/cabins');
    } catch (err) {
      setArchiveError(err?.response?.data?.message || err.message || 'Archive failed');
    } finally {
      setArchiveBusy(false);
    }
  };

  const openContentEdit = () => {
    const content = data?.contentMedia || {};
    const op = data?.operationalSettings || {};
    setContentEditForm({
      name: content.name || '',
      description: content.description || '',
      hostName: content.hostName || '',
      i18nBgName: content.i18n?.bg?.name || '',
      i18nBgLocation: content.i18n?.bg?.location || '',
      i18nBgDescription: content.i18n?.bg?.description || '',
      avgResponseTimeHours:
        op?.avgResponseTimeHours != null
          ? String(op.avgResponseTimeHours)
          : content?.avgResponseTimeHours != null
            ? String(content.avgResponseTimeHours)
            : '',
      highlightsText: Array.isArray(content.highlights) ? content.highlights.join('\n') : '',
      superhostEnabled: Boolean(content.badges?.superhost?.enabled),
      superhostLabel: content.badges?.superhost?.label || 'Superhost',
      guestFavoriteEnabled: Boolean(content.badges?.guestFavorite?.enabled),
      guestFavoriteLabel: content.badges?.guestFavorite?.label || 'Guest favorite'
    });
    setContentEditError('');
    setContentEditSuccess('');
    setContentEditOpen(true);
  };

  const saveContentEdit = async () => {
    setContentEditBusy(true);
    setContentEditError('');
    setContentEditSuccess('');
    try {
      const highlights = contentEditForm.highlightsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5);
      const payload = {
        name: contentEditForm.name.trim(),
        description: contentEditForm.description.trim(),
        hostName: contentEditForm.hostName.trim(),
        i18n: {
          bg: {
            name: contentEditForm.i18nBgName.trim(),
            location: contentEditForm.i18nBgLocation.trim(),
            description: contentEditForm.i18nBgDescription.trim()
          }
        },
        highlights,
        badges: {
          superhost: {
            enabled: contentEditForm.superhostEnabled,
            label: contentEditForm.superhostLabel.trim() || 'Superhost'
          },
          guestFavorite: {
            enabled: contentEditForm.guestFavoriteEnabled,
            label: contentEditForm.guestFavoriteLabel.trim() || 'Guest favorite'
          }
        }
      };
      const avgText = contentEditForm.avgResponseTimeHours.trim();
      if (avgText !== '') {
        payload.avgResponseTimeHours = Number(avgText);
      }
      await opsWriteAPI.updateCabinContent(id, payload);
      await loadDetail();
      setContentEditSuccess('Content updated.');
      setContentEditOpen(false);
    } catch (err) {
      setContentEditError(err?.response?.data?.message || 'Failed to update content');
    } finally {
      setContentEditBusy(false);
    }
  };

  const openArrivalEdit = () => {
    const content = data?.contentMedia || {};
    const op = data?.operationalSettings || {};
    const pre = data?.preArrival || {};
    const geo = content?.geoLocation;
    const meeting = op?.meetingPoint;
    setArrivalEditForm({
      location: content.location || '',
      geoLatitude: geo?.latitude != null ? String(geo.latitude) : '',
      geoLongitude: geo?.longitude != null ? String(geo.longitude) : '',
      geoZoom: geo?.zoom != null ? String(geo.zoom) : '11',
      meetingLabel: meeting?.label || '',
      meetingGoogleMapsUrl: meeting?.googleMapsUrl || '',
      meetingWhat3words: meeting?.what3words || '',
      meetingLat: meeting?.lat != null ? String(meeting.lat) : '',
      meetingLng: meeting?.lng != null ? String(meeting.lng) : '',
      arrivalWindowDefault: pre.arrivalWindowDefault || '',
      arrivalGuideUrl: pre.arrivalGuideUrl || '',
      safetyNotes: pre.safetyNotes || '',
      emergencyContact: pre.emergencyContact || '',
      packingListText: Array.isArray(pre.packingList) ? pre.packingList.join('\n') : ''
    });
    setArrivalEditError('');
    setArrivalEditSuccess('');
    setArrivalEditOpen(true);
  };

  const saveArrivalEdit = async () => {
    setArrivalEditBusy(true);
    setArrivalEditError('');
    setArrivalEditSuccess('');
    try {
      const packingList = arrivalEditForm.packingListText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const payload = {
        location: arrivalEditForm.location.trim(),
        meetingPoint: {
          label: arrivalEditForm.meetingLabel.trim(),
          googleMapsUrl: arrivalEditForm.meetingGoogleMapsUrl.trim(),
          what3words: arrivalEditForm.meetingWhat3words.trim()
        },
        arrivalWindowDefault: arrivalEditForm.arrivalWindowDefault.trim(),
        arrivalGuideUrl: arrivalEditForm.arrivalGuideUrl.trim(),
        safetyNotes: arrivalEditForm.safetyNotes.trim(),
        emergencyContact: arrivalEditForm.emergencyContact.trim(),
        packingList
      };

      const hasGeoLat = arrivalEditForm.geoLatitude.trim() !== '';
      const hasGeoLng = arrivalEditForm.geoLongitude.trim() !== '';
      if (hasGeoLat || hasGeoLng) {
        payload.geoLocation = {
          latitude: hasGeoLat ? Number(arrivalEditForm.geoLatitude.trim()) : undefined,
          longitude: hasGeoLng ? Number(arrivalEditForm.geoLongitude.trim()) : undefined,
          zoom: arrivalEditForm.geoZoom.trim() !== '' ? Number(arrivalEditForm.geoZoom.trim()) : 11
        };
      }
      if (arrivalEditForm.meetingLat.trim() !== '') {
        payload.meetingPoint.lat = Number(arrivalEditForm.meetingLat.trim());
      }
      if (arrivalEditForm.meetingLng.trim() !== '') {
        payload.meetingPoint.lng = Number(arrivalEditForm.meetingLng.trim());
      }

      await opsWriteAPI.updateCabinArrival(id, payload);
      await loadDetail();
      setArrivalEditSuccess('Arrival details updated.');
      setArrivalEditOpen(false);
    } catch (err) {
      setArrivalEditError(err?.response?.data?.message || 'Failed to update arrival details');
    } finally {
      setArrivalEditBusy(false);
    }
  };

  const openCutoffsEdit = () => {
    const op = data?.operationalSettings || {};
    const rows = Array.isArray(op.transportCutoffs)
      ? op.transportCutoffs.map((item) => ({
          type: item?.type ? String(item.type) : 'Horse',
          lastDeparture: item?.lastDeparture ? String(item.lastDeparture) : '16:30'
        }))
      : [];
    setCutoffsEditRows(rows);
    setCutoffsEditError('');
    setCutoffsEditSuccess('');
    setCutoffsEditOpen(true);
  };

  const addCutoffRow = () => {
    setCutoffsEditRows((prev) => [...prev, { type: 'Horse', lastDeparture: '16:30' }]);
  };

  const removeCutoffRow = (index) => {
    setCutoffsEditRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateCutoffRow = (index, field, value) => {
    setCutoffsEditRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const saveCutoffsEdit = async () => {
    setCutoffsEditBusy(true);
    setCutoffsEditError('');
    setCutoffsEditSuccess('');
    try {
      const payload = {
        transportCutoffs: cutoffsEditRows.map((row) => ({
          type: String(row.type || '').trim(),
          lastDeparture: String(row.lastDeparture || '').trim()
        }))
      };
      await opsWriteAPI.updateCabinTransportCutoffs(id, payload);
      await loadDetail();
      setCutoffsEditSuccess('Transport cutoffs updated.');
      setCutoffsEditOpen(false);
    } catch (err) {
      setCutoffsEditError(err?.response?.data?.message || 'Failed to update transport cutoffs');
    } finally {
      setCutoffsEditBusy(false);
    }
  };

  const openTransportOptionsEdit = () => {
    const op = data?.operationalSettings || {};
    const rows = Array.isArray(op.transportOptions)
      ? op.transportOptions.map((item) => ({
          type: item?.type ? String(item.type) : '',
          pricePerPerson: item?.pricePerPerson != null ? String(item.pricePerPerson) : '0',
          description: item?.description ? String(item.description) : '',
          duration: item?.duration ? String(item.duration) : '',
          isAvailable: item?.isAvailable !== false
        }))
      : [];
    setTransportOptionsEditRows(rows);
    setTransportOptionsEditError('');
    setTransportOptionsEditSuccess('');
    setTransportOptionsEditOpen(true);
  };

  const addTransportOptionRow = () => {
    setTransportOptionsEditRows((prev) => [
      ...prev,
      { type: '', pricePerPerson: '0', description: '', duration: '', isAvailable: true }
    ]);
  };

  const removeTransportOptionRow = (index) => {
    setTransportOptionsEditRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateTransportOptionRow = (index, field, value) => {
    setTransportOptionsEditRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const saveTransportOptionsEdit = async () => {
    setTransportOptionsEditBusy(true);
    setTransportOptionsEditError('');
    setTransportOptionsEditSuccess('');
    try {
      const payload = {
        transportOptions: transportOptionsEditRows.map((row) => ({
          type: String(row.type || '').trim(),
          pricePerPerson: Number(row.pricePerPerson),
          description: String(row.description || '').trim(),
          duration: String(row.duration || '').trim(),
          isAvailable: row.isAvailable !== false
        }))
      };
      await opsWriteAPI.updateCabinTransportOptions(id, payload);
      await loadDetail();
      setTransportOptionsEditSuccess('Transport options updated.');
      setTransportOptionsEditOpen(false);
    } catch (err) {
      setTransportOptionsEditError(err?.response?.data?.message || 'Failed to update transport options');
    } finally {
      setTransportOptionsEditBusy(false);
    }
  };

  const openOccupancyEdit = () => {
    const op = data?.operationalSettings || {};
    setOccupancyEditForm({
      capacity: op.capacity != null ? String(op.capacity) : '',
      minNights: op.minNights != null ? String(op.minNights) : ''
    });
    setOccupancyEditError('');
    setOccupancyEditSuccess('');
    setOccupancyEditOpen(true);
  };

  const saveOccupancyEdit = async () => {
    setOccupancyEditBusy(true);
    setOccupancyEditError('');
    setOccupancyEditSuccess('');
    try {
      const payload = {
        capacity: Number(occupancyEditForm.capacity),
        minNights: Number(occupancyEditForm.minNights)
      };
      await opsWriteAPI.updateCabinOccupancy(id, payload);
      await loadDetail();
      setOccupancyEditSuccess('Occupancy settings updated.');
      setOccupancyEditOpen(false);
    } catch (err) {
      setOccupancyEditError(err?.response?.data?.message || 'Failed to update occupancy settings');
    } finally {
      setOccupancyEditBusy(false);
    }
  };

  const openPricingEdit = () => {
    const op = data?.operationalSettings || {};
    setPricingEditForm({
      pricePerNight: op.pricePerNight != null ? String(op.pricePerNight) : ''
    });
    setPricingEditError('');
    setPricingEditSuccess('');
    setPricingEditOpen(true);
  };

  const savePricingEdit = async () => {
    setPricingEditBusy(true);
    setPricingEditError('');
    setPricingEditSuccess('');
    try {
      const payload = {
        pricePerNight: Number(pricingEditForm.pricePerNight)
      };
      await opsWriteAPI.updateCabinPricing(id, payload);
      await loadDetail();
      setPricingEditSuccess('Pricing updated.');
      setPricingEditOpen(false);
    } catch (err) {
      setPricingEditError(err?.response?.data?.message || 'Failed to update pricing');
    } finally {
      setPricingEditBusy(false);
    }
  };

  const openExperiencesEdit = () => {
    const content = data?.contentMedia || {};
    const rows = Array.isArray(content.experiences)
      ? content.experiences.map((item, index) => ({
          key: item?.key ? String(item.key) : '',
          name: item?.name ? String(item.name) : '',
          price: item?.price != null ? String(item.price) : '0',
          currency: item?.currency ? String(item.currency) : 'BGN',
          unit: item?.unit === 'per_guest' ? 'per_guest' : 'flat_per_stay',
          active: item?.active !== false,
          sortOrder: item?.sortOrder != null ? String(item.sortOrder) : String(index)
        }))
      : [];
    setExperiencesEditRows(rows);
    setExperiencesEditError('');
    setExperiencesEditSuccess('');
    setExperiencesEditOpen(true);
  };

  const addExperienceRow = () => {
    setExperiencesEditRows((prev) => [
      ...prev,
      {
        key: '',
        name: '',
        price: '0',
        currency: 'BGN',
        unit: 'flat_per_stay',
        active: true,
        sortOrder: String(prev.length)
      }
    ]);
  };

  const removeExperienceRow = (index) => {
    setExperiencesEditRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateExperienceRow = (index, field, value) => {
    setExperiencesEditRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const saveExperiencesEdit = async () => {
    setExperiencesEditBusy(true);
    setExperiencesEditError('');
    setExperiencesEditSuccess('');
    try {
      const usedKeys = new Set();
      const experiences = experiencesEditRows
        .map((row, index) => ({
          key: String(row.key || '').trim(),
          name: String(row.name || '').trim(),
          price: Number(row.price),
          currency: String(row.currency || 'BGN').trim() || 'BGN',
          unit: row.unit === 'per_guest' ? 'per_guest' : 'flat_per_stay',
          active: row.active !== false,
          sortOrder: Number(row.sortOrder ?? index)
        }))
        .filter((row) => row.name !== '')
        .map((row) => {
          const currentKey = row.key;
          if (currentKey && !usedKeys.has(currentKey)) {
            usedKeys.add(currentKey);
            return row;
          }
          return { ...row, key: buildExperienceKey(row.name, usedKeys) };
        });

      const payload = { experiences };
      await opsWriteAPI.updateCabinExperiences(id, payload);
      await loadDetail();
      setExperiencesEditSuccess('Experiences updated.');
      setExperiencesEditOpen(false);
    } catch (err) {
      setExperiencesEditError(err?.response?.data?.message || 'Failed to update experiences');
    } finally {
      setExperiencesEditBusy(false);
    }
  };

  if (loading) {
    return (
      <OpsPage width="wide">
        <div className="ops-cd">
          <DetailHeader title="Cabin" />
          <OpsLoadingState label="Loading cabin…" />
        </div>
      </OpsPage>
    );
  }

  if (error && !data) {
    return (
      <OpsPage width="wide">
        <div className="ops-cd">
          <DetailHeader title="Cabin" />
          <OpsBanner tone="danger" title={error} />
        </div>
      </OpsPage>
    );
  }

  if (!data) {
    return (
      <OpsPage width="wide">
        <div className="ops-cd">
          <DetailHeader title="Cabin" />
          <OpsEmptyState title="Not found." />
        </div>
      </OpsPage>
    );
  }

  const isMulti = data?.kind === 'multi_unit_type';
  const op = data?.operationalSettings || {};
  const content = data?.contentMedia || {};
  const pre = data?.preArrival || {};
  const degraded = data?.degraded || {};
  const titleId = isMulti ? data?.cabinTypeId : data?.cabinId;
  const cover = content.imageUrl;
  const geo = content?.geoLocation;
  const meeting = op?.meetingPoint;
  const summary = op?.unitBlockedDatesSummary;
  const blockedList = !isMulti && Array.isArray(op.blockedDates) ? op.blockedDates : [];
  const cabinTitle = content.name || 'Cabin';

  const headerMeta = (
    <div className="ops-cd-header-meta">
      <div className="ops-cd-header-meta__badges">
        <OpsBadge>{isMulti ? 'Multi-unit type' : 'Single cabin'}</OpsBadge>
      </div>
      {content.hostName ? <p className="ops-cd-header-meta__line">Host: {content.hostName}</p> : null}
      <p className={`ops-cd-header-meta__muted ops-cd-mono`}>{titleId}</p>
      {data.slug ? <p className={`ops-cd-header-meta__muted ops-cd-mono`}>Slug: {data.slug}</p> : null}
      <p className="ops-cd-header-meta__line">{content.location || '—'}</p>
    </div>
  );

  const headerActions = (
    <div className="ops-cd-actions">
      <OpsButton variant="secondary" size="compact" onClick={openContentEdit}>
        Edit content
      </OpsButton>
      <OpsButton variant="secondary" size="compact" onClick={openArrivalEdit}>
        Edit arrival
      </OpsButton>
      {contentEditSuccess ? <span className="ops-cd-note ops-cd-note--ok">{contentEditSuccess}</span> : null}
      {contentEditError ? <OpsInlineError>{contentEditError}</OpsInlineError> : null}
      {arrivalEditSuccess ? <span className="ops-cd-note ops-cd-note--ok">{arrivalEditSuccess}</span> : null}
      {arrivalEditError ? <OpsInlineError>{arrivalEditError}</OpsInlineError> : null}
      {occupancyEditSuccess ? <span className="ops-cd-note ops-cd-note--ok">{occupancyEditSuccess}</span> : null}
      {occupancyEditError ? <OpsInlineError>{occupancyEditError}</OpsInlineError> : null}
      {pricingEditSuccess ? <span className="ops-cd-note ops-cd-note--ok">{pricingEditSuccess}</span> : null}
      {pricingEditError ? <OpsInlineError>{pricingEditError}</OpsInlineError> : null}
      {experiencesEditSuccess ? <span className="ops-cd-note ops-cd-note--ok">{experiencesEditSuccess}</span> : null}
      {experiencesEditError ? <OpsInlineError>{experiencesEditError}</OpsInlineError> : null}
    </div>
  );

  return (
    <OpsPage width="wide">
      <div className="ops-cd">
        <DetailHeader title={cabinTitle} meta={headerMeta} actions={headerActions} />

        <div className="ops-cd-banners">
          {showCreatedBanner ? (
            <OpsBanner
              tone="success"
              title="Cabin created successfully."
              action={
                <OpsButton variant="quiet" size="compact" onClick={() => setShowCreatedBanner(false)}>
                  Dismiss
                </OpsButton>
              }
            />
          ) : null}
          {degraded.missingGeo ? (
            <OpsBanner tone="warning" title="Degraded: missing geo coordinates." />
          ) : null}
          {degraded.emptyInventory ? (
            <OpsBanner tone="warning" title="Degraded: no units linked to this cabin type." />
          ) : null}
        </div>

        <section className="ops-cd-surface">
          <div className="ops-cd-identity">
            <div className="ops-cd-identity__thumb">
              {cover ? (
                <img src={normalizeMediaSrc(cover)} alt="" />
              ) : (
                <div className="ops-cd-identity__thumb-fallback">{thumbInitials(content.name)}</div>
              )}
            </div>
            <div className="ops-cd-identity__body">
              <p className="ops-cd-note ops-cd-note--strong">{content.location || '—'}</p>
            </div>
          </div>
        </section>

        <CabinContentEditor
          contentEditOpen={contentEditOpen}
          contentForm={contentEditForm}
          setContentForm={setContentEditForm}
          contentBusy={contentEditBusy}
          contentMessage={contentEditSuccess}
          contentError={contentEditError}
          onOpen={openContentEdit}
          onCancel={() => {
            setContentEditOpen(false);
            setContentEditError('');
          }}
          onSave={saveContentEdit}
        />

        <CabinArrivalEditor
          arrivalEditOpen={arrivalEditOpen}
          arrivalForm={arrivalEditForm}
          setArrivalForm={setArrivalEditForm}
          arrivalBusy={arrivalEditBusy}
          arrivalError={arrivalEditError}
          onCancel={() => {
            setArrivalEditOpen(false);
            setArrivalEditError('');
          }}
          onSave={saveArrivalEdit}
        />

        <CabinOccupancyPricingEditor
          occupancyEditOpen={occupancyEditOpen}
          occupancyForm={occupancyEditForm}
          setOccupancyForm={setOccupancyEditForm}
          occupancyBusy={occupancyEditBusy}
          occupancyError={occupancyEditError}
          onCancelOccupancy={() => {
            setOccupancyEditOpen(false);
            setOccupancyEditError('');
          }}
          onSaveOccupancy={saveOccupancyEdit}
          pricingEditOpen={pricingEditOpen}
          pricingForm={pricingEditForm}
          setPricingForm={setPricingEditForm}
          pricingBusy={pricingEditBusy}
          pricingError={pricingEditError}
          onCancelPricing={() => {
            setPricingEditOpen(false);
            setPricingEditError('');
          }}
          onSavePricing={savePricingEdit}
        />

        <CabinExperiencesEditor
          experiencesEditOpen={experiencesEditOpen}
          experiencesRows={experiencesEditRows}
          experiencesBusy={experiencesEditBusy}
          experiencesError={experiencesEditError}
          onAddRow={addExperienceRow}
          onRemoveRow={removeExperienceRow}
          onUpdateRow={updateExperienceRow}
          onCancel={() => {
            setExperiencesEditOpen(false);
            setExperiencesEditError('');
          }}
          onSave={saveExperiencesEdit}
        />

        <div className="ops-cd-grid ops-cd-grid--2">
          <OpsReadOnlyDetailSection title="Location &amp; coordinates">
            <p>
              <span className="ops-cd-note--strong">Address / label:</span> {content.location || '—'}
            </p>
            {geo?.latitude != null && geo?.longitude != null ? (
              <p className="ops-cd-mono ops-cd-note">
                {Number(geo.latitude).toFixed(5)}, {Number(geo.longitude).toFixed(5)}
                {geo.zoom != null ? ` · zoom ${geo.zoom}` : ''}
              </p>
            ) : (
              <p className="ops-cd-note">No map coordinates stored.</p>
            )}
          </OpsReadOnlyDetailSection>

          <OpsReadOnlyDetailSection title="Meeting point &amp; arrival">
            {meeting?.label ? (
              <p>
                <span className="ops-cd-note--strong">Meeting point:</span> {meeting.label}
              </p>
            ) : (
              <p className="ops-cd-note">No meeting point label.</p>
            )}
            {meeting?.googleMapsUrl ? (
              <p>
                <span className="ops-cd-note--strong">Maps:</span>{' '}
                <span className="ops-cd-mono">{meeting.googleMapsUrl}</span>
              </p>
            ) : null}
            {meeting?.what3words ? (
              <p>
                <span className="ops-cd-note--strong">what3words:</span> {meeting.what3words}
              </p>
            ) : null}
            {meeting?.lat != null && meeting?.lng != null ? (
              <p className="ops-cd-mono ops-cd-note">
                Meeting lat/lng: {meeting.lat}, {meeting.lng}
              </p>
            ) : null}
            <p>
              <span className="ops-cd-note--strong">Default arrival window:</span>{' '}
              {pre.arrivalWindowDefault?.trim() ? pre.arrivalWindowDefault : '—'}
            </p>
            <p>
              <span className="ops-cd-note--strong">Arrival guide URL:</span>{' '}
              {pre.arrivalGuideUrl ? <span className="ops-cd-mono">{pre.arrivalGuideUrl}</span> : '—'}
            </p>
          </OpsReadOnlyDetailSection>
        </div>

        <OpsReadOnlyDetailSection title="Safety &amp; emergency">
          <p>
            <span className="ops-cd-note--strong">Emergency contact:</span>{' '}
            {pre.emergencyContact?.trim() ? pre.emergencyContact : '—'}
          </p>
          <div>
            <p className="ops-cd-note--strong">Safety notes</p>
            {pre.safetyNotes?.trim() ? (
              <p className="ops-cd-fact__value">{pre.safetyNotes}</p>
            ) : (
              <p className="ops-cd-note">—</p>
            )}
          </div>
        </OpsReadOnlyDetailSection>

        <div className="ops-cd-grid ops-cd-grid--2">
          <section className="ops-cd-surface">
            <div className="ops-cd-surface__head">
              <h2 className="ops-cd-surface__title">Operational settings</h2>
              <div className="ops-cd-actions">
                <OpsButton variant="secondary" size="compact" onClick={openOccupancyEdit}>
                  Edit occupancy
                </OpsButton>
                <OpsButton variant="secondary" size="compact" onClick={openPricingEdit}>
                  Edit price
                </OpsButton>
              </div>
            </div>
            <dl className="ops-cd-facts">
              <Fact label="Capacity" numeric>
                {op.capacity ?? '—'}
              </Fact>
              <Fact label="Min guests" numeric>
                {op.minGuests ?? '—'}
              </Fact>
              <Fact label="Min nights" numeric>
                {op.minNights ?? '—'}
              </Fact>
              <Fact label="Price/night" numeric>
                {op.pricePerNight ?? '—'}
              </Fact>
              <Fact label="Pricing model">{op.pricingModel ?? '—'}</Fact>
              {isMulti ? (
                <Fact label="Unit legacy blocked dates" wide>
                  {summary?.totalBlockedDateEntries ?? 0} entries across {summary?.unitsWithBlockedDates ?? 0}{' '}
                  unit(s)
                </Fact>
              ) : (
                <Fact label="Legacy blocked dates (cabin)" numeric>
                  {op.blockedDatesCount ?? op.blockedDates?.length ?? 0}
                </Fact>
              )}
              <Fact label="Transport options" numeric>
                {op.transportOptions?.length ?? 0}
              </Fact>
              <Fact label="Transport cutoffs" numeric>
                {Array.isArray(op.transportCutoffs) ? op.transportCutoffs.length : 0}
              </Fact>
            </dl>
          </section>

          <section className="ops-cd-surface">
            <h2 className="ops-cd-surface__title">Content &amp; media</h2>
            <div className="ops-cd-surface__body">
              {cover ? (
                <img src={normalizeMediaSrc(cover)} alt="" className="ops-cd-cover" />
              ) : (
                <p className="ops-cd-note">No cover image.</p>
              )}
              {content.description ? <p className="ops-cd-fact__value">{content.description}</p> : null}
            </div>
          </section>
        </div>

        <OpsReadOnlyDetailSection
          title="Transport"
          actions={
            <>
              <OpsButton variant="secondary" size="compact" onClick={openTransportOptionsEdit}>
                Edit transport options
              </OpsButton>
              <OpsButton variant="secondary" size="compact" onClick={openCutoffsEdit}>
                Edit cutoffs
              </OpsButton>
              {transportOptionsEditSuccess ? (
                <span className="ops-cd-note ops-cd-note--ok">{transportOptionsEditSuccess}</span>
              ) : null}
              {transportOptionsEditError ? <OpsInlineError>{transportOptionsEditError}</OpsInlineError> : null}
              {cutoffsEditSuccess ? <span className="ops-cd-note ops-cd-note--ok">{cutoffsEditSuccess}</span> : null}
              {cutoffsEditError ? <OpsInlineError>{cutoffsEditError}</OpsInlineError> : null}
            </>
          }
        >
          {Array.isArray(op.transportOptions) && op.transportOptions.length > 0 ? (
            <ul className="ops-cd-list">
              {op.transportOptions.map((t, i) => (
                <li key={i} className="ops-cd-list-item">
                  <p className="ops-cd-list-item__title">{t.type || '—'}</p>
                  <p className="ops-cd-list-item__meta">{t.description || '—'}</p>
                  <p className="ops-cd-list-item__muted">
                    {t.duration || '—'} · {t.pricePerPerson != null ? `${t.pricePerPerson}/person` : '—'} ·{' '}
                    {t.isAvailable === false ? 'Unavailable' : 'Available'}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ops-cd-note">No transport options configured.</p>
          )}
          {Array.isArray(op.transportCutoffs) && op.transportCutoffs.length > 0 ? (
            <>
              <hr className="ops-cd-divider" />
              <p className="ops-cd-note--strong">Last departure cutoffs</p>
              <ul className="ops-cd-list">
                {op.transportCutoffs.map((c, i) => (
                  <li key={i} className="ops-cd-list-item__meta ops-cd-mono">
                    {c.type || '—'} — {c.lastDeparture || '—'}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </OpsReadOnlyDetailSection>

        <CabinTransportEditor
          transportOptionsEditOpen={transportOptionsEditOpen}
          transportOptionsForm={transportOptionsEditRows}
          setTransportOptionsForm={setTransportOptionsEditRows}
          transportOptionsBusy={transportOptionsEditBusy}
          transportOptionsError={transportOptionsEditError}
          onCancelTransportOptions={() => {
            setTransportOptionsEditOpen(false);
            setTransportOptionsEditError('');
          }}
          onSaveTransportOptions={saveTransportOptionsEdit}
          onAddTransportOptionRow={addTransportOptionRow}
          onRemoveTransportOptionRow={removeTransportOptionRow}
          onUpdateTransportOptionRow={updateTransportOptionRow}
          transportCutoffsEditOpen={cutoffsEditOpen}
          transportCutoffsForm={cutoffsEditRows}
          setTransportCutoffsForm={setCutoffsEditRows}
          transportCutoffsBusy={cutoffsEditBusy}
          transportCutoffsError={cutoffsEditError}
          onCancelTransportCutoffs={() => {
            setCutoffsEditOpen(false);
            setCutoffsEditError('');
          }}
          onSaveTransportCutoffs={saveCutoffsEdit}
          onAddTransportCutoffRow={addCutoffRow}
          onRemoveTransportCutoffRow={removeCutoffRow}
          onUpdateTransportCutoffRow={updateCutoffRow}
        />

        <OpsReadOnlyDetailSection title="Highlights, badges &amp; experiences">
          <div>
            <p className="ops-cd-note--strong">Highlights</p>
            {content.highlights?.length ? (
              <ul className="ops-cd-list ops-cd-list--bullets">
                {content.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            ) : (
              <p className="ops-cd-note">—</p>
            )}
          </div>
          <hr className="ops-cd-divider" />
          <div>
            <p className="ops-cd-note--strong">Badges</p>
            {content.badges?.superhost?.enabled || content.badges?.guestFavorite?.enabled ? (
              <ul className="ops-cd-list">
                {content.badges.superhost?.enabled ? (
                  <li className="ops-cd-list-item__meta">
                    Superhost: {content.badges.superhost.label || 'Superhost'}
                  </li>
                ) : null}
                {content.badges.guestFavorite?.enabled ? (
                  <li className="ops-cd-list-item__meta">
                    Guest favorite: {content.badges.guestFavorite.label || 'Guest favorite'}
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="ops-cd-note">None enabled.</p>
            )}
          </div>
          <hr className="ops-cd-divider" />
          <div>
            <div className="ops-cd-actions ops-cd-actions--spaced">
              <OpsButton variant="secondary" size="compact" onClick={openExperiencesEdit}>
                Edit experiences
              </OpsButton>
            </div>
            <p className="ops-cd-note--strong">Experiences</p>
            {Array.isArray(content.experiences) && content.experiences.length > 0 ? (
              <ul className="ops-cd-list">
                {content.experiences.map((ex, i) => (
                  <li key={ex.key ? String(ex.key) : `exp-${i}`} className="ops-cd-list-item">
                    <p className="ops-cd-list-item__title">{ex.name || '—'}</p>
                    <p className="ops-cd-list-item__meta">
                      {ex.price != null ? `${ex.price} ${ex.currency || 'BGN'}` : '—'} · {ex.unit || 'flat_per_stay'} ·{' '}
                      {ex.active === false ? 'Inactive' : 'Active'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ops-cd-note">—</p>
            )}
          </div>
        </OpsReadOnlyDetailSection>

        <OpsReadOnlyDetailSection title="Blocked dates (legacy cabin fields)">
          {isMulti ? (
            <p>
              Per-unit blocked date entries:{' '}
              <span className="ops-cd-mono">{summary?.totalBlockedDateEntries ?? 0}</span> across{' '}
              <span className="ops-cd-mono">{summary?.unitsWithBlockedDates ?? 0}</span> unit(s). See units table for
              per-unit counts.
            </p>
          ) : blockedList.length > 0 ? (
            <>
              <p className="ops-cd-note">
                Count: {op.blockedDatesCount ?? blockedList.length} · day-level blocks stored on the cabin document.
              </p>
              <p className="ops-cd-mono ops-cd-note">
                {blockedList.map((d) => formatDateOnlyForOps(d)).filter(Boolean).join(', ')}
              </p>
            </>
          ) : (
            <p className="ops-cd-note">No legacy blocked dates on this cabin.</p>
          )}
        </OpsReadOnlyDetailSection>

        <CabinMediaManager titleId={titleId} isMulti={isMulti} content={content} onReload={loadDetail} />

        {isMulti && Array.isArray(data.units) ? (
          <CabinUnitsEditor units={data.units} onReload={loadDetail} />
        ) : null}

        <OpsReadOnlyDetailSection title="Packing list (pre-arrival)">
          {pre.packingList?.length ? (
            <ul className="ops-cd-list ops-cd-list--bullets">
              {pre.packingList.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="ops-cd-note">No packing list items.</p>
          )}
        </OpsReadOnlyDetailSection>

        {!isMulti ? (
          <section className="ops-cd-surface ops-cd-surface--danger">
            <h2 className="ops-cd-surface__title">Danger zone</h2>
            <p className="ops-cd-surface__subtitle">
              Archiving hides this cabin from public listings, search, quotes, and booking. This does not delete data.
            </p>
            <div className="ops-cd-actions">
              <OpsButton
                variant="destructive"
                onClick={() => {
                  setArchiveReason('');
                  setArchiveConfirmName('');
                  setArchiveError('');
                  setArchiveModalOpen(true);
                }}
              >
                Archive cabin
              </OpsButton>
            </div>
          </section>
        ) : null}

        <ArchiveCabinModal
          open={archiveModalOpen && !isMulti}
          onClose={() => setArchiveModalOpen(false)}
          cabinDisplayName={content.name || ''}
          archiveConfirmName={archiveConfirmName}
          setArchiveConfirmName={setArchiveConfirmName}
          archiveReason={archiveReason}
          setArchiveReason={setArchiveReason}
          archiveError={archiveError}
          archiveBusy={archiveBusy}
          onSubmit={handleArchiveSubmit}
        />
      </div>
    </OpsPage>
  );
}
