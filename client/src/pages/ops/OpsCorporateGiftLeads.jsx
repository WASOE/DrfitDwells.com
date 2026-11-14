import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsCollectionRow from '../../ops/primitives/OpsCollectionRow';

const statuses = ['new', 'researching', 'contacted', 'negotiating', 'won', 'lost'];

export default function OpsCorporateGiftLeads() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('new');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const query = params.toString();
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const request = id ? opsReadAPI.corporateGiftLead(id) : opsReadAPI.corporateGiftLeads(Object.fromEntries(new URLSearchParams(query)));
    request.then((response) => {
      if (!active) return;
      const result = response.data.data;
      setData(result);
      if (id) { setStatus(result.status); setNotes(result.notes || ''); }
    }).catch((err) => {
      if (active) { setData(null); setError(err?.response?.data?.message || 'Failed to load corporate gift leads.'); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, query, revision]);

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await opsReadAPI.updateCorporateGiftLead(id, { status, notes }); setRevision((n) => n + 1); }
    catch (err) { setError(err?.response?.data?.message || 'Failed to save lead.'); }
    finally { setBusy(false); }
  };
  const retry = async (lane) => {
    setBusy(true); setError('');
    try { await opsReadAPI.retryCorporateGiftLead(id, lane); }
    catch (err) { setError(err?.response?.data?.message || 'Delivery retry failed.'); }
    finally { setBusy(false); setRevision((n) => n + 1); }
  };
  return (
    <OpsPage width="wide">
      <OpsPageHeader title={id ? 'Corporate gift lead' : 'Corporate gift leads'} description="Private nominations and HR proposal requests." />
      {id && <p><Link to="/ops/corporate-gift-leads">← Corporate gift leads</Link></p>}
      {error && <OpsBanner tone="danger" body={error} />}
      {loading && <OpsLoadingState label="Loading corporate gift leads…" />}
      {!loading && !id && data && <>
        <form onSubmit={(event) => { event.preventDefault(); updateFilter('q', event.currentTarget.elements.q.value.trim()); }}>
          <OpsTextField label="Search company" name="q" defaultValue={params.get('q') || ''} />
          <OpsButton type="submit">Search</OpsButton>
          <OpsSelect label="Status" value={params.get('status') || ''} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </OpsSelect>
        </form>
        {!data.items.length && <p>No matching corporate gift leads.</p>}
        {data.items.map((row) => <OpsCollectionRow key={row._id} to={`/ops/corporate-gift-leads/${row._id}`}
          title={row.company} meta={`${row.type === 'hr' ? 'HR request' : 'Nomination'} · ${new Date(row.createdAt).toLocaleDateString()}`}
          status={`${row.status}${row.type === 'nomination' && !row.hrEmails?.length ? ' · needs contact research' : ''} · email ${row.email?.status} · notification ${row.notification?.status}`} />)}
        <p>Page {data.page} · {data.total} leads</p>
        {data.page > 1 && <OpsButton onClick={() => updateFilter('page', String(data.page - 1))}>Previous</OpsButton>}
        {data.page * 20 < data.total && <OpsButton onClick={() => updateFilter('page', String(data.page + 1))}>Next</OpsButton>}
      </>}
      {!loading && id && data && <>
        <h2>{data.company}</h2>
        <p><strong>Submission:</strong> {data.type === 'hr' ? 'HR request' : 'Employee nomination'}</p>
        <p><strong>Received:</strong> {new Date(data.createdAt).toLocaleString()}</p>
        {data.companyWebsites?.length > 0 && <p><strong>Company websites:</strong> {data.companyWebsites.join(', ')}</p>}
        {data.hrContacts?.length > 0 && <p><strong>HR contact names:</strong> {data.hrContacts.join(', ')}</p>}
        {data.type === 'nomination' && <><p><strong>HR emails:</strong> {data.hrEmails?.join(', ') || 'Not provided'}</p><p><strong>Contact research:</strong> {data.hrEmails?.length ? 'HR email provided' : 'Needed'}</p></>}
        {data.type === 'hr' && <><p><strong>Contact:</strong> {data.contactName} · {data.contactEmail}</p><p><strong>Employees:</strong> {data.employeeCount || '—'} · <strong>Budget:</strong> {data.budget || '—'}</p><p><strong>Message:</strong> {data.message || '—'}</p></>}
        <p><strong>Attribution:</strong> {Object.entries(data.attribution || {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'Not provided'}</p>
        {['email', 'notification'].map((lane) => <div key={lane}>
          <p><strong>{lane === 'email' ? 'Email to jose@driftdwells.com' : 'Admin notification'}:</strong> {data[lane]?.status} {data[lane]?.lastError && `— ${data[lane].lastError}`}</p>
          {data[lane]?.status !== 'sent' && <OpsButton disabled={busy} onClick={() => retry(lane)}>Retry {lane}</OpsButton>}
        </div>)}
        <form onSubmit={save}>
          <OpsSelect label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}</OpsSelect>
          <label style={{ display: 'block', margin: '1rem 0' }}>Internal notes<textarea style={{ display: 'block', width: '100%', minHeight: 140 }} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={10000} /></label>
          <OpsButton type="submit" disabled={busy}>Save changes</OpsButton>
        </form>
      </>}
    </OpsPage>
  );
}
