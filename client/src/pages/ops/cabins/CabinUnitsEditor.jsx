import { useEffect, useMemo, useRef, useState } from 'react';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsCheckbox from '../../../ops/primitives/OpsCheckbox';
import OpsStatus from '../../../ops/primitives/OpsStatus';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../../../ops/primitives/OpsTable';
import OpsTextField from '../../../ops/primitives/OpsTextField';
import OpsTextarea from '../../../ops/primitives/OpsTextarea';
import { opsWriteAPI } from '../../../services/opsApi';
import { CabinEditorSection } from './CabinEditorSection';

function UnitAirbnbIcsRow({ unit, onReload }) {
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(unit.displayName || '');
  const [adminNotes, setAdminNotes] = useState(unit.adminNotes || '');
  const [isActive, setIsActive] = useState(unit.isActive !== false);
  const [label, setLabel] = useState(unit.airbnbListingLabel || '');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const hintTimeoutRef = useRef(null);

  useEffect(() => {
    setDisplayName(unit.displayName || '');
    setAdminNotes(unit.adminNotes || '');
    setIsActive(unit.isActive !== false);
    setLabel(unit.airbnbListingLabel || '');
  }, [unit.unitId, unit.displayName, unit.adminNotes, unit.isActive, unit.airbnbListingLabel]);

  useEffect(
    () => () => {
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current);
        hintTimeoutRef.current = null;
      }
    },
    []
  );

  const fullUrl = useMemo(() => {
    if (unit.icsExportUrl) return unit.icsExportUrl;
    if (typeof window !== 'undefined' && unit.icsExportPath) {
      return `${window.location.origin}${unit.icsExportPath}`;
    }
    return unit.icsExportPath || '';
  }, [unit.icsExportPath, unit.icsExportUrl]);

  const showHint = (message) => {
    setHint(message);
    if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    hintTimeoutRef.current = setTimeout(() => {
      setHint('');
      hintTimeoutRef.current = null;
    }, 2000);
  };

  const copy = async () => {
    if (!unit.isActive || !fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      showHint('Copied');
    } catch {
      showHint('Copy failed');
    }
  };

  const saveUnit = async () => {
    setHint('');
    setBusy(true);
    try {
      await opsWriteAPI.patchUnitChannelLabel(unit.unitId, {
        displayName,
        adminNotes,
        isActive,
        airbnbListingLabel: label
      });
      await onReload();
      setIsEditing(false);
      showHint('Saved');
    } catch (error) {
      setHint(error?.response?.data?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setHint('');
    setDisplayName(unit.displayName || '');
    setAdminNotes(unit.adminNotes || '');
    setIsActive(unit.isActive !== false);
    setLabel(unit.airbnbListingLabel || '');
  };

  return (
    <OpsTableRow>
      <OpsTableCell className="ops-cabin-units__mono ops-cabin-units__nowrap">
        {unit.unitNumber}
      </OpsTableCell>
      <OpsTableCell>
        {isEditing ? (
          <OpsTextField
            label="Display name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={100}
            placeholder="Display name"
          />
        ) : (
          unit.displayName || '—'
        )}
      </OpsTableCell>
      <OpsTableCell>
        {isEditing ? (
          <OpsCheckbox
            label="Active"
            hint="Inactive units are excluded from assignment and availability."
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
        ) : (
          <OpsStatus domain="unit" value={unit.isActive ? 'active' : 'inactive'} />
        )}
      </OpsTableCell>
      <OpsTableCell numeric>{unit.blockedDatesCount ?? 0}</OpsTableCell>
      <OpsTableCell className="ops-cabin-units__listing">
        {isEditing ? (
          <div className="ops-cabin-units__stack">
            <OpsTextField
              label="Airbnb listing label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Airbnb listing name / id"
              maxLength={200}
            />
            <OpsTextarea
              label="Admin notes"
              value={adminNotes}
              onChange={(event) => setAdminNotes(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Internal notes for operators"
            />
            <div className="ops-cabin-units__actions">
              <OpsButton size="compact" loading={busy} onClick={saveUnit}>
                Save
              </OpsButton>
              <OpsButton variant="secondary" size="compact" disabled={busy} onClick={cancelEdit}>
                Cancel
              </OpsButton>
            </div>
          </div>
        ) : (
          <div className="ops-cabin-units__stack">
            <p>Label: {unit.airbnbListingLabel || '—'}</p>
            <p className="ops-cabin-units__muted">Notes: {unit.adminNotes || '—'}</p>
            <OpsButton
              variant="secondary"
              size="compact"
              onClick={() => {
                setIsEditing(true);
                setHint('');
              }}
            >
              Edit unit
            </OpsButton>
          </div>
        )}
      </OpsTableCell>
      <OpsTableCell className="ops-cabin-units__export">
        {unit.isActive ? (
          <div className="ops-cabin-units__stack">
            <p className="ops-cabin-units__url">{fullUrl}</p>
            <div className="ops-cabin-units__actions">
              <OpsButton size="compact" onClick={copy} disabled={busy}>
                Copy ICS URL
              </OpsButton>
              {hint ? <span className="ops-cabin-units__hint">{hint}</span> : null}
            </div>
          </div>
        ) : (
          <span className="ops-cabin-units__muted">No export (inactive unit)</span>
        )}
      </OpsTableCell>
    </OpsTableRow>
  );
}

export default function CabinUnitsEditor({ units, onReload }) {
  if (!Array.isArray(units)) return null;

  return (
    <CabinEditorSection
      title="Units & Airbnb calendar export"
      description={`One Airbnb listing imports one .ics URL per physical unit. Paste only the URL for the matching unit. Set PUBLIC_SITE_ORIGIN on the server for absolute copy URLs; otherwise the app origin is used. ${units.length} unit(s) in database.`}
      className="ops-cabin-units"
    >
      <OpsTable caption="Cabin units and Airbnb calendar exports">
        <OpsTableHead>
          <OpsTableRow>
            <OpsTableHeader>Unit</OpsTableHeader>
            <OpsTableHeader>Display</OpsTableHeader>
            <OpsTableHeader>Active</OpsTableHeader>
            <OpsTableHeader numeric>Blocked</OpsTableHeader>
            <OpsTableHeader>Airbnb listing label</OpsTableHeader>
            <OpsTableHeader>ICS URL for Airbnb</OpsTableHeader>
          </OpsTableRow>
        </OpsTableHead>
        <OpsTableBody>
          {units.map((unit) => (
            <UnitAirbnbIcsRow key={unit.unitId} unit={unit} onReload={onReload} />
          ))}
        </OpsTableBody>
      </OpsTable>
    </CabinEditorSection>
  );
}
