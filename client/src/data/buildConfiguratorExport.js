import {
  buildSummaryRows,
  computeBuildTotal,
  formatBuildBarPrice,
  formatBuildPrice,
  getConsultationOptionIds,
  getDisplayArea,
  getDisplayDimensions,
  getOptionById,
} from './buildConfiguratorLogic.js';
import { getBuildModel } from './buildConfiguratorSchema.js';

export function buildBuildEnquiryMailto(state, contactEmail) {
  const model = getBuildModel(state.modelId);
  const pricing = computeBuildTotal(state);
  const totalLabel = formatBuildBarPrice(pricing);
  const dimensions = getDisplayDimensions(state);
  const area = getDisplayArea(state);
  const configRows = buildSummaryRows(state).filter((row) => row.key !== 'Model');

  const lines = [
    `Model: ${model.name} (${formatBuildPrice(model.basePrice)} base)`,
    `Dimensions: ${dimensions} · ${area}`,
    `Estimate: ${totalLabel}`,
  ];

  if (configRows.length) {
    const optionsLine = configRows.map((row) => `${row.key}: ${row.value}`).join('; ');
    lines.push(`Options: ${optionsLine}`);
  }

  if (model.summaryNote) {
    lines.push(model.summaryNote);
  }

  const subject = `Drift & Dwells build enquiry — ${model.name}`;
  const body = lines.slice(0, 8).join('\n');

  return `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Structured PDF content for tests and downloadBuildSpecPdf. */
export function buildBuildSpecPdfContent(state, contactEmail) {
  const model = getBuildModel(state.modelId);
  const pricing = computeBuildTotal(state);
  const totalLabel = formatBuildBarPrice(pricing);
  const rows = buildSummaryRows(state);
  const consultationIds = getConsultationOptionIds(state);
  const consultationNames = consultationIds
    .map((id) => getOptionById(id)?.name)
    .filter(Boolean);

  return {
    model,
    pricing,
    totalLabel,
    rows,
    consultationIds,
    consultationNames,
    dimensions: getDisplayDimensions(state),
    area: getDisplayArea(state),
    contactEmail,
    hasCustomSizeRow: rows.some((row) => row.key === 'Size'),
    summaryNote: model.summaryNote ?? null,
  };
}

export async function downloadBuildSpecPdf(state, contactEmail) {
  const { jsPDF } = await import('jspdf');
  const content = buildBuildSpecPdfContent(state, contactEmail);
  const { model, totalLabel, rows, consultationNames, summaryNote } = content;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const contentWidth = 500;
  let y = margin;

  const setHeading = (text, size = 12) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    doc.setTextColor(0, 0, 0);
    doc.text(text, margin, y);
    y += size + 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
  };

  const ensureSpace = (needed = 80) => {
    if (y > 720 - needed) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Drift & Dwells Build Specification', margin, y);
  y += 24;
  doc.setFontSize(14);
  doc.text(model.name, margin, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(
    `Generated: ${new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })}`,
    margin,
    y
  );
  y += 20;

  setHeading('Model & Price', 12);
  doc.setTextColor(0, 0, 0);
  doc.text(`Model: ${model.name}`, margin, y);
  y += 14;
  doc.text(`Base price: ${formatBuildPrice(model.basePrice)}`, margin, y);
  y += 14;
  doc.text(`Dimensions: ${content.dimensions}`, margin, y);
  y += 14;
  doc.text(`Area: ${content.area}`, margin, y);
  y += 14;
  doc.text(`Capacity: ${model.capacity}`, margin, y);
  y += 18;

  setHeading('Your Configuration', 12);
  rows.forEach((row) => {
    ensureSpace(20);
    doc.text(`${row.key}: ${row.value}`, margin, y, { maxWidth: contentWidth });
    y += 14;
  });
  y += 8;

  ensureSpace(60);
  setHeading('Estimate', 12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`Total: ${totalLabel}`, margin, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  if (consultationNames.length) {
    ensureSpace(40);
    const names = consultationNames.join(', ');
    doc.setTextColor(80, 80, 80);
    doc.text(`Price at consultation: ${names}`, margin, y, { maxWidth: contentWidth });
    y += 16;
    doc.setTextColor(0, 0, 0);
  }

  if (summaryNote) {
    ensureSpace(40);
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(summaryNote, margin, y, { maxWidth: contentWidth });
    y += 28;
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
  }

  ensureSpace(80);
  setHeading('Next Steps', 12);
  doc.text('1. Review this specification', margin, y);
  y += 14;
  doc.text(`2. Contact us at ${contactEmail}`, margin, y);
  y += 14;
  doc.text('3. Schedule a design consultation', margin, y);
  y += 14;
  doc.text('4. Finalize contract and timeline', margin, y);

  const shortId = Math.random().toString(36).slice(2, 6).toUpperCase();
  const dateStamp = new Date().toISOString().slice(0, 10);
  const slug = model.name.replace(/[^a-z0-9]+/gi, '_');
  doc.save(`DriftDwells_Build_${slug}_${dateStamp}_${shortId}.pdf`);
}
