import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OPS_STATUS_ALIASES,
  OPS_STATUS_FAMILIES,
  OPS_STATUS_LOUDNESS,
  getOpsStatusByKey,
  listOpsStatusEntries,
  resolveOpsStatus
} from './opsStatusRegistry.js';

describe('opsStatusRegistry', () => {
  const entries = listOpsStatusEntries();

  it('keeps aliases domain-scoped', () => {
    expect(OPS_STATUS_ALIASES.pending).toBeUndefined();
    for (const [domain, map] of Object.entries(OPS_STATUS_ALIASES)) {
      expect(domain).toMatch(/^[a-z_]+$/);
      for (const [from, to] of Object.entries(map)) {
        const target = getOpsStatusByKey(to);
        expect(target, `${domain}.${from} → ${to}`).toBeTruthy();
        expect(target.domain).toBe(domain);
      }
    }
  });

  it('has unique namespaced keys', () => {
    const keys = entries.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z_]+\.[a-z0-9_]+$/);
    }
  });

  it('requires English label, valid family, and valid loudness on every entry', () => {
    for (const entry of entries) {
      expect(entry.label.en, entry.key).toBeTruthy();
      expect(OPS_STATUS_FAMILIES, entry.key).toContain(entry.family);
      expect(OPS_STATUS_LOUDNESS, entry.key).toContain(entry.loudness);
      expect(['hold', 'blocked', 'purple']).not.toContain(entry.family);
    }
  });

  it('only puts Bulgarian labels on cleaner-facing cleaning statuses', () => {
    const withBg = entries.filter((entry) => entry.label.bg);
    expect(withBg.map((entry) => entry.key).sort()).toEqual([
      'cleaning.done',
      'cleaning.pending',
      'cleaning.same_day_turn',
      'cleaning_payment.paid',
      'cleaning_payment.partial',
      'cleaning_payment.pending'
    ]);
    expect(getOpsStatusByKey('cleaning.pending').label.bg).toBe('За почистване');
    expect(getOpsStatusByKey('cleaning.done').label.bg).toBe('Почистено');
    expect(getOpsStatusByKey('cleaning.same_day_turn').label.bg).toBe('Смяна в същия ден');
    expect(getOpsStatusByKey('cleaning_payment.pending').label.bg).toBe('За плащане');
    expect(getOpsStatusByKey('cleaning_payment.partial').label.bg).toBe('Частично платено');
    expect(getOpsStatusByKey('cleaning_payment.paid').label.bg).toBe('Платено');
  });

  it('encodes locked family corrections', () => {
    expect(resolveOpsStatus('cleaning', 'pending').family).toBe('warning');
    expect(resolveOpsStatus('sync', 'stale').family).toBe('warning');
    expect(resolveOpsStatus('review', 'approved').family).toBe('success');
    expect(resolveOpsStatus('reservation', 'in_house').family).toBe('info');
    expect(resolveOpsStatus('reservation', 'in_house').family).not.toBe('danger');
  });

  it('keeps pending lookups domain-specific', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reservationPending = resolveOpsStatus('reservation', 'pending');
    const paymentPending = resolveOpsStatus('payment', 'pending_verification');
    const cleaningPending = resolveOpsStatus('cleaning', 'pending');
    const commissionPending = resolveOpsStatus('commission', 'pending');

    expect(reservationPending.key).toBe('reservation.pending');
    expect(reservationPending.family).toBe('neutral');
    expect(paymentPending.key).toBe('payment.pending_verification');
    expect(paymentPending.family).toBe('warning');
    expect(cleaningPending.key).toBe('cleaning.pending');
    expect(commissionPending.key).toBe('commission.pending');

    expect(resolveOpsStatus('payment', 'pending').unknown).toBe(true);
    expect(resolveOpsStatus('payment', 'pending').key).not.toBe('reservation.pending');
    expect(resolveOpsStatus('payment', 'pending').key).not.toBe('cleaning.pending');
    warn.mockRestore();
  });

  it('resolves commission void and voided to commission.voided', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(OPS_STATUS_ALIASES.commission.void).toBe('commission.voided');
    expect(OPS_STATUS_ALIASES.commission.voided).toBe('commission.voided');
    expect(resolveOpsStatus('commission', 'void').key).toBe('commission.voided');
    expect(resolveOpsStatus('commission', 'voided').key).toBe('commission.voided');
    expect(resolveOpsStatus('voucher', 'void').unknown).toBe(true);
    warn.mockRestore();
  });

  it('returns a neutral fallback for unknown values without mutating the registry', () => {
    const beforeCount = listOpsStatusEntries().length;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fallback = resolveOpsStatus('reservation', 'totally_made_up');

    expect(fallback.unknown).toBe(true);
    expect(fallback.family).toBe('neutral');
    expect(fallback.label.en).toBe('Totally made up');
    expect(fallback.key).toBe('reservation.totally_made_up');
    expect(getOpsStatusByKey('reservation.totally_made_up')).toBeNull();
    expect(listOpsStatusEntries()).toHaveLength(beforeCount);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not crash on empty or null backend values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveOpsStatus('reservation', null).unknown).toBe(true);
    expect(resolveOpsStatus('reservation', '').unknown).toBe(true);
    expect(resolveOpsStatus('', 'pending').unknown).toBe(true);
    warn.mockRestore();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
