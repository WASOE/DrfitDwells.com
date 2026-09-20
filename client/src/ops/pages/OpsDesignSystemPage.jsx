import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { OpsRoot, useOpsAppearance } from '../appearance/OpsAppearanceProvider';
import { OPS_APPEARANCE_MODES } from '../appearance/opsAppearance';
import { getOpsCleanerMessage, listOpsCleanerMessageKeys } from '../i18n/opsUiLanguage';
import OpsBadge from '../primitives/OpsBadge';
import OpsBanner from '../primitives/OpsBanner';
import OpsButton from '../primitives/OpsButton';
import OpsCheckbox from '../primitives/OpsCheckbox';
import OpsCollectionRow from '../primitives/OpsCollectionRow';
import OpsConfirmDialog from '../primitives/OpsConfirmDialog';
import OpsEmptyState from '../primitives/OpsEmptyState';
import OpsIconButton from '../primitives/OpsIconButton';
import OpsInlineError from '../primitives/OpsInlineError';
import OpsLoadingState from '../primitives/OpsLoadingState';
import OpsModal from '../primitives/OpsModal';
import OpsPageHeader from '../primitives/OpsPageHeader';
import OpsPagination from '../primitives/OpsPagination';
import OpsSelect from '../primitives/OpsSelect';
import OpsSheet from '../primitives/OpsSheet';
import OpsStatus from '../primitives/OpsStatus';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../primitives/OpsTable';
import OpsTextField from '../primitives/OpsTextField';
import OpsTextarea from '../primitives/OpsTextarea';
import './OpsDesignSystemPage.css';

const APPEARANCE_LABELS = {
  system: 'System',
  light: 'Light',
  dark: 'Dark'
};

const COLOR_SWATCHES = [
  { token: '--ops-canvas', label: 'canvas' },
  { token: '--ops-surface', label: 'surface' },
  { token: '--ops-surface-subtle', label: 'surface subtle' },
  { token: '--ops-surface-elevated', label: 'surface elevated' },
  { token: '--ops-border', label: 'border' },
  { token: '--ops-border-strong', label: 'border strong' },
  { token: '--ops-border-control', label: 'control border' },
  { token: '--ops-text', label: 'primary text' },
  { token: '--ops-text-secondary', label: 'secondary text' },
  { token: '--ops-text-muted', label: 'muted text' },
  { token: '--ops-text-disabled', label: 'disabled text' },
  { token: '--ops-accent', label: 'accent' },
  { token: '--ops-accent-soft', label: 'accent soft' },
  { token: '--ops-success', label: 'success' },
  { token: '--ops-warning', label: 'warning' },
  { token: '--ops-danger', label: 'danger' },
  { token: '--ops-info', label: 'info' },
  { token: '--ops-focus', label: 'focus' }
];

const SPACE_TOKENS = [
  ['--ops-space-4', '4'],
  ['--ops-space-8', '8'],
  ['--ops-space-12', '12'],
  ['--ops-space-16', '16'],
  ['--ops-space-24', '24'],
  ['--ops-space-32', '32'],
  ['--ops-space-48', '48']
];

const STATUS_KEYS = [
  'reservation.pending',
  'reservation.confirmed',
  'reservation.in_house',
  'payment.paid',
  'payment.failed',
  'cleaning.pending',
  'cleaning.done',
  'sync.healthy',
  'sync.stale',
  'sync.failed',
  'review.approved',
  'review.pending',
  'voucher.active',
  'voucher.expired',
  'manual_review.critical',
  'commission.voided',
  'quote.converted'
];

const SAMPLE_STAYS = [
  {
    guest: 'Elena Petrova',
    stay: '12–15 Oct',
    property: 'The Cabin',
    status: 'reservation.confirmed',
    amount: '€420.00'
  },
  {
    guest: 'Георги Иванов',
    stay: '18–20 Oct',
    property: 'Valley Stay',
    status: 'reservation.pending',
    amount: '€280.00'
  },
  {
    guest: 'Maya Dimitrova',
    stay: '22–25 Oct',
    property: 'A-Frame',
    status: 'reservation.in_house',
    amount: '€510.00'
  }
];

const CLEANER_SAMPLE_KEYS = listOpsCleanerMessageKeys();

function Section({ id, title, note, children }) {
  return (
    <section className="ops-ds-section" aria-labelledby={id}>
      <h2 id={id} className="ops-ds-section__title">
        {title}
      </h2>
      {note ? <p className="ops-ds-section__note">{note}</p> : null}
      {children}
    </section>
  );
}

function AppearanceControl() {
  const { mode, setMode } = useOpsAppearance();
  return (
    <div className="ops-ds-appearance" role="group" aria-label="Appearance">
      {OPS_APPEARANCE_MODES.map((value) => (
        <OpsButton
          key={value}
          variant={mode === value ? 'secondary' : 'quiet'}
          size="compact"
          aria-pressed={mode === value}
          onClick={() => setMode(value)}
        >
          {APPEARANCE_LABELS[value]}
        </OpsButton>
      ))}
    </div>
  );
}

function PaginationSample() {
  const [page, setPage] = useState(2);
  return <OpsPagination page={page} totalPages={5} onPageChange={setPage} />;
}

export default function OpsDesignSystemPage() {
  const [overlay, setOverlay] = useState(null);

  return (
    <OpsRoot themed className="ops-ds-page" data-testid="ops-design-system">
      <OpsPageHeader
        title="Design system"
        description="Internal review surface for locked Ops tokens and primitives. Not a production workflow."
        meta={<span className="ops-ds-type-meta">Admin only · v1.2</span>}
        actions={<AppearanceControl />}
      />

      <Section id="ops-ds-type" title="Typography" note="Locked Inter scale. Sentence case. No Playfair.">
        <div className="ops-ds-stack">
          <div>
            <span className="ops-ds-type-role">Page title · 20/28 · 600</span>
            <p className="ops-ds-type-page">Reservations</p>
          </div>
          <div>
            <span className="ops-ds-type-role">Section title · 15/20 · 600</span>
            <p className="ops-ds-type-section">Open stays</p>
          </div>
          <div>
            <span className="ops-ds-type-role">Body · 14/20 · 400</span>
            <p className="ops-ds-type-body">Three arrivals today at The Cabin. Payment is confirmed.</p>
          </div>
          <div>
            <span className="ops-ds-type-role">Body strong · 14/20 · 600</span>
            <p className="ops-ds-type-strong">Check-in is after 15:00.</p>
          </div>
          <div>
            <span className="ops-ds-type-role">Compact / table · 13/18 · 400</span>
            <p className="ops-ds-type-compact">Георги Иванов · Valley Stay · 18–20 Oct</p>
          </div>
          <div>
            <span className="ops-ds-type-role">Label · 13/18 · 500</span>
            <p className="ops-ds-type-label">Guest email</p>
          </div>
          <div>
            <span className="ops-ds-type-role">Metadata · 12/16 · 400</span>
            <p className="ops-ds-type-meta">Updated 2 minutes ago</p>
          </div>
          <div>
            <span className="ops-ds-type-role">Button text · 14/20 · 500</span>
            <p className="ops-ds-type-button">Save stay</p>
          </div>
        </div>
      </Section>

      <Section id="ops-ds-color" title="Colors" note="Semantic tokens only. Switch Light/Dark to inspect both appearances.">
        <div className="ops-ds-swatches">
          {COLOR_SWATCHES.map((swatch) => (
            <div key={swatch.token} className="ops-ds-swatch">
              <div className="ops-ds-swatch__chip" style={{ background: `var(${swatch.token})` }} />
              <p className="ops-ds-swatch__name">
                {swatch.label}
                <br />
                {swatch.token}
              </p>
            </div>
          ))}
        </div>
        <p className="ops-ds-section__note">Focus ring uses --ops-focus.</p>
        <div className="ops-ds-focus-sample">Guest name</div>
      </Section>

      <Section
        id="ops-ds-page-width"
        title="Page width"
        note="OpsPage maxima from the locked guide. Unmigrated routes still use max-w-7xl. This page is not wrapped in OpsPage."
      >
        <p className="ops-ds-type-body">narrow 720 · default 1040 · wide 1360 · full none</p>
      </Section>

      <Section id="ops-ds-space" title="Spacing" note="4px atomic unit. Allowed: 4, 8, 12, 16, 24, 32, 48.">
        <div className="ops-ds-space-row">
          {SPACE_TOKENS.map(([token, label]) => (
            <div key={token} className="ops-ds-space">
              <div className="ops-ds-space__box" style={{ width: `var(${token})`, height: `var(${token})` }} />
              {label}
            </div>
          ))}
        </div>
      </Section>

      <Section id="ops-ds-radius" title="Radius" note="Controls 6px. Surfaces and overlays 8px. No large marketing radius.">
        <div className="ops-ds-radius-row">
          <div>
            <div className="ops-ds-radius" style={{ borderRadius: 'var(--ops-radius-control)' }} />
            <p className="ops-ds-type-meta">control</p>
          </div>
          <div>
            <div className="ops-ds-radius" style={{ borderRadius: 'var(--ops-radius-surface)' }} />
            <p className="ops-ds-type-meta">surface</p>
          </div>
        </div>
      </Section>

      <Section id="ops-ds-elevation" title="Elevation" note="Shadows are for floating UI only. Static surfaces stay flat.">
        <div className="ops-ds-elevation-row">
          <div className="ops-ds-elevation ops-ds-elevation--overlay">Overlay shadow</div>
          <div className="ops-ds-elevation ops-ds-elevation--modal">Modal shadow</div>
        </div>
      </Section>

      <Section id="ops-ds-buttons" title="Buttons">
        <div className="ops-ds-wrap">
          <OpsButton>Save</OpsButton>
          <OpsButton variant="secondary">Cancel</OpsButton>
          <OpsButton variant="quiet">More</OpsButton>
          <OpsButton variant="destructive">Delete stay</OpsButton>
          <OpsButton loading>Save</OpsButton>
          <OpsButton size="compact">Compact</OpsButton>
          <OpsButton disabled>Disabled</OpsButton>
        </div>
      </Section>

      <Section id="ops-ds-icon-buttons" title="Icon buttons">
        <OpsIconButton label="Edit stay">
          <Pencil size={18} aria-hidden="true" />
        </OpsIconButton>
      </Section>

      <Section id="ops-ds-fields" title="Text fields">
        <div className="ops-ds-grid">
          <OpsTextField label="Guest name" defaultValue="Elena Petrova" />
          <OpsTextField label="Email" hint="Used for the confirmation." optional />
          <OpsTextField label="Phone" error="Enter a valid phone number." defaultValue="0" />
          <OpsTextField label="Reference" disabled defaultValue="RSV-2041" />
        </div>
      </Section>

      <Section id="ops-ds-select" title="Select">
        <div className="ops-ds-grid">
          <OpsSelect label="Property" defaultValue="cabin">
            <option value="cabin">The Cabin</option>
            <option value="valley">Valley Stay</option>
            <option value="aframe">A-Frame</option>
          </OpsSelect>
        </div>
      </Section>

      <Section id="ops-ds-textarea" title="Textarea">
        <OpsTextarea
          label="Internal note"
          defaultValue="Guest arrives after 21:00. Leave the key box code in the welcome message."
        />
      </Section>

      <Section id="ops-ds-checkbox" title="Checkbox">
        <OpsCheckbox label="Send confirmation email" defaultChecked />
      </Section>

      <Section id="ops-ds-badges" title="Badges">
        <div className="ops-ds-wrap">
          <OpsBadge>Internal</OpsBadge>
          <OpsBadge tone="info">Needs review</OpsBadge>
        </div>
      </Section>

      <Section id="ops-ds-status" title="Statuses" note="Resolved through the P0B registry. No showcase-only mappings.">
        <div className="ops-ds-status-list">
          {STATUS_KEYS.map((key) => (
            <div key={key} className="ops-ds-status-item">
              <code>{key}</code>
              <OpsStatus name={key} />
            </div>
          ))}
          <div className="ops-ds-status-item" data-testid="ops-ds-commission-void">
            <code>commission void</code>
            <OpsStatus domain="commission" value="void" />
          </div>
        </div>
      </Section>

      <Section id="ops-ds-header" title="Page header">
        <OpsPageHeader
          title="Reservations"
          description="Open stays for the next 7 days."
          actions={<OpsButton>Create stay</OpsButton>}
        />
      </Section>

      <Section id="ops-ds-table" title="Table" note="Wide collections use a wrapping table. Amounts are numeric and end-aligned.">
        <OpsTable caption="Sample stays">
          <OpsTableHead>
            <OpsTableRow>
              <OpsTableHeader>Guest</OpsTableHeader>
              <OpsTableHeader>Stay</OpsTableHeader>
              <OpsTableHeader>Property</OpsTableHeader>
              <OpsTableHeader>Status</OpsTableHeader>
              <OpsTableHeader align="end" numeric>
                Amount
              </OpsTableHeader>
            </OpsTableRow>
          </OpsTableHead>
          <OpsTableBody>
            {SAMPLE_STAYS.map((row) => (
              <OpsTableRow key={row.guest}>
                <OpsTableCell>{row.guest}</OpsTableCell>
                <OpsTableCell>{row.stay}</OpsTableCell>
                <OpsTableCell>{row.property}</OpsTableCell>
                <OpsTableCell>
                  <OpsStatus name={row.status} />
                </OpsTableCell>
                <OpsTableCell align="end" numeric>
                  {row.amount}
                </OpsTableCell>
              </OpsTableRow>
            ))}
          </OpsTableBody>
        </OpsTable>
      </Section>

      <Section
        id="ops-ds-rows"
        title="Collection row"
        note="Narrow alternative for the same stay data. Title, metadata, status, and a trailing action. No nested links."
      >
        <div className="ops-ds-rows">
          {SAMPLE_STAYS.map((row) => (
            <OpsCollectionRow
              key={row.guest}
              title={row.guest}
              meta={`${row.property} · ${row.stay} · ${row.amount}`}
              status={<OpsStatus name={row.status} />}
              actions={
                <OpsButton variant="quiet" size="compact">
                  Open
                </OpsButton>
              }
            />
          ))}
        </div>
      </Section>

      <Section id="ops-ds-pagination" title="Pagination" note="Previous, page context, Next. URL-agnostic. No page-size selector.">
        <PaginationSample />
      </Section>

      <Section id="ops-ds-banners" title="Banners">
        <div className="ops-ds-stack">
          <OpsBanner tone="info" title="Sync is healthy" body="Airbnb last seen 4 minutes ago." />
          <OpsBanner tone="success" title="Payment captured" body="€420.00 is on the stay." />
          <OpsBanner tone="warning" title="Sync stale" body="Valley Stay has not synced in 2 hours." />
          <OpsBanner
            tone="danger"
            title="Payment failed"
            body="The guest card was declined. Do not mark the stay confirmed."
          />
        </div>
      </Section>

      <Section id="ops-ds-loading" title="Loading state">
        <OpsLoadingState label="Loading stays" />
      </Section>

      <Section id="ops-ds-empty" title="Empty states">
        <div className="ops-ds-stack">
          <OpsEmptyState
            title="No stays in this range"
            body="Try a different date range or property."
            action={<OpsButton variant="secondary">Clear filters</OpsButton>}
          />
          <OpsEmptyState
            variant="filtered"
            title="No matches"
            body="No stays match the current filters."
          />
        </div>
      </Section>

      <Section id="ops-ds-error" title="Inline error">
        <OpsInlineError>Check-out must be after check-in.</OpsInlineError>
      </Section>

      <Section id="ops-ds-overlays" title="Overlays" note="Real P0C2 primitives. Modal stays a modal. Sheet stays a sheet.">
        <div className="ops-ds-wrap">
          <OpsButton variant="secondary" onClick={() => setOverlay('modal')}>
            Open modal
          </OpsButton>
          <OpsButton variant="secondary" onClick={() => setOverlay('sheet-bottom')}>
            Open bottom sheet
          </OpsButton>
          <OpsButton variant="secondary" onClick={() => setOverlay('sheet-right')}>
            Open right sheet
          </OpsButton>
          <OpsButton variant="secondary" onClick={() => setOverlay('confirm')}>
            Open confirm
          </OpsButton>
          <OpsButton variant="destructive" onClick={() => setOverlay('confirm-destructive')}>
            Open destructive confirm
          </OpsButton>
        </div>

        <OpsModal
          open={overlay === 'modal'}
          onClose={() => setOverlay(null)}
          title="Edit stay"
          description="Update the guest-facing dates. This does not change inventory until you save."
          footer={
            <>
              <OpsButton variant="secondary" onClick={() => setOverlay(null)}>
                Cancel
              </OpsButton>
              <OpsButton onClick={() => setOverlay(null)}>Save</OpsButton>
            </>
          }
        >
          <OpsTextField label="Guest name" defaultValue="Elena Petrova" />
        </OpsModal>

        <OpsSheet
          open={overlay === 'sheet-bottom'}
          onClose={() => setOverlay(null)}
          side="bottom"
          title="Filters"
          description="Narrow the stay list."
          footer={
            <OpsButton onClick={() => setOverlay(null)}>Apply filters</OpsButton>
          }
        >
          <OpsSelect label="Property" defaultValue="all">
            <option value="all">All properties</option>
            <option value="cabin">The Cabin</option>
          </OpsSelect>
        </OpsSheet>

        <OpsSheet
          open={overlay === 'sheet-right'}
          onClose={() => setOverlay(null)}
          side="right"
          title="Stay details"
          description="Contextual actions for this stay."
        >
          <p className="ops-ds-type-body">Elena Petrova · The Cabin · 12–15 Oct</p>
        </OpsSheet>

        <OpsConfirmDialog
          open={overlay === 'confirm'}
          title="Discard unsaved dates?"
          body="The stay will keep the dates currently saved."
          confirmLabel="Discard"
          onCancel={() => setOverlay(null)}
          onConfirm={() => setOverlay(null)}
        />

        <OpsConfirmDialog
          open={overlay === 'confirm-destructive'}
          title="Delete this stay?"
          body="This cannot be undone from Ops."
          tone="destructive"
          confirmLabel="Delete"
          onCancel={() => setOverlay(null)}
          onConfirm={() => setOverlay(null)}
        />
      </Section>

      <Section
        id="ops-ds-cleaner"
        title="Cleaner EN/BG sample"
        note="Preview of the P0B cleaner namespace. This page stays English."
      >
        <div className="ops-ds-locale-list">
          {CLEANER_SAMPLE_KEYS.map((key) => (
            <div key={key} className="ops-ds-locale-item" data-ops-cleaner-key={key}>
              <div>
                <code>{key}</code>
                <p className="ops-ds-type-meta">EN {getOpsCleanerMessage(key, 'en')}</p>
              </div>
              <p data-ops-cleaner-bg={key}>{getOpsCleanerMessage(key, 'bg')}</p>
            </div>
          ))}
        </div>
      </Section>
    </OpsRoot>
  );
}
