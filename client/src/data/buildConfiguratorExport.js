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

/** Brand palette (matches the /build visual language). */
const PDF_BRAND = {
  ink: [26, 26, 26],
  ink2: [43, 43, 43],
  mid: [90, 90, 90],
  muted: [154, 154, 154],
  faint: [136, 136, 136],
  border: [224, 224, 224],
  cream: [250, 249, 247],
  white: [255, 255, 255],
  website: 'driftanddwells.com',
  tagline: 'Off-grid timber homes, handcrafted in Bulgaria.',
};

/** Builds the branded jsPDF document (returned, not saved) — reusable in tests/tools. */
export async function createBuildSpecPdfDoc(state, contactEmail) {
  const { jsPDF } = await import('jspdf');
  const content = buildBuildSpecPdfContent(state, contactEmail);
  const { model, totalLabel, rows, consultationNames, summaryNote } = content;
  const C = PDF_BRAND;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  const fill = (rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  const stroke = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  const ink = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

  // ——— Header band with brand mark ———
  const headerH = 100;
  fill(C.ink);
  doc.rect(0, 0, pageW, headerH, 'F');

  // Logo mark: ring + roofline
  const cx = margin + 13;
  const cy = 42;
  stroke(C.white);
  doc.setLineWidth(1.3);
  doc.circle(cx, cy, 13, 'S');
  doc.setLineWidth(1.1);
  doc.line(cx - 7, cy + 3, cx, cy - 4);
  doc.line(cx, cy - 4, cx + 7, cy + 3);

  // Wordmark
  ink(C.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('DRIFT & DWELLS', margin + 36, cy - 2, { charSpace: 2 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  ink([180, 180, 180]);
  doc.text('HANDCRAFTED STORIES', margin + 36, cy + 10, { charSpace: 2 });

  // Document label (right)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  ink([170, 170, 170]);
  doc.text('BUILD SPECIFICATION', pageW - margin, cy + 2, {
    align: 'right',
    charSpace: 2,
  });

  let y = headerH + 44;

  // ——— Model title ———
  ink(C.ink);
  doc.setFont('times', 'bold');
  doc.setFontSize(30);
  doc.text(model.name, margin, y);
  y += 18;

  const generated = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  ink(C.muted);
  doc.text(`Build specification  ·  Generated ${generated}`, margin, y);
  y += 26;

  // ——— Estimate block ———
  const estH = 80;
  fill(C.ink);
  doc.roundedRect(margin, y, contentW, estH, 3, 3, 'F');
  const estCx = pageW / 2;
  ink([136, 136, 136]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('YOUR ESTIMATE', estCx, y + 22, { align: 'center', charSpace: 2 });
  ink(C.white);
  doc.setFont('times', 'normal');
  doc.setFontSize(28);
  doc.text(totalLabel, estCx, y + 50, { align: 'center' });
  ink([136, 136, 136]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('All-inclusive  ·  Delivery & installation included', estCx, y + 66, {
    align: 'center',
  });
  y += estH + 30;

  // ——— Section label helper ———
  const sectionLabel = (text) => {
    ink(C.faint);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(text.toUpperCase(), margin, y, { charSpace: 1.5 });
    y += 8;
    stroke(C.border);
    doc.setLineWidth(0.7);
    doc.line(margin, y, margin + contentW, y);
    y += 16;
  };

  const ensureSpace = (needed) => {
    if (y + needed > pageH - 64) {
      doc.addPage();
      y = margin + 10;
    }
  };

  // ——— Model & dimensions (2-col cells) ———
  sectionLabel('Model & Dimensions');
  const cells = [
    ['Model', model.name],
    ['Base price', formatBuildPrice(model.basePrice)],
    ['Dimensions', content.dimensions],
    ['Area', content.area],
    ['Capacity', model.capacity],
  ];
  const colW = contentW / 2;
  let cellY = y;
  cells.forEach((cell, i) => {
    const col = i % 2;
    const x = margin + col * colW;
    if (col === 0 && i > 0) cellY += 34;
    ink(C.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(cell[0].toUpperCase(), x, cellY, { charSpace: 1 });
    ink(C.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(String(cell[1]), x, cellY + 14);
  });
  y = cellY + 34;

  // ——— Configuration line items ———
  ensureSpace(40);
  sectionLabel('Your Configuration');
  doc.setFontSize(9.5);
  rows
    .filter((row) => row.key !== 'Model')
    .forEach((row) => {
      ensureSpace(22);
      const valueLines = doc.splitTextToSize(String(row.value), contentW - 150);
      ink(C.mid);
      doc.setFont('helvetica', 'normal');
      doc.text(row.key, margin, y);
      ink(C.ink);
      valueLines.forEach((line, li) => {
        doc.text(line, margin + contentW, y + li * 12, { align: 'right' });
      });
      const rowH = Math.max(14, valueLines.length * 12 + 4);
      y += rowH;
      stroke(C.border);
      doc.setLineWidth(0.5);
      doc.line(margin, y - 6, margin + contentW, y - 6);
    });
  y += 12;

  // ——— Consultation footnote ———
  if (consultationNames.length) {
    ensureSpace(50);
    const note = `Priced at consultation: ${consultationNames.join(', ')}. These items are tailored to your site and finalised together — your estimate above already reflects everything else.`;
    const noteLines = doc.splitTextToSize(note, contentW - 28);
    const boxH = noteLines.length * 12 + 22;
    fill(C.cream);
    stroke(C.border);
    doc.setLineWidth(0.7);
    doc.roundedRect(margin, y, contentW, boxH, 3, 3, 'FD');
    ink(C.mid);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(noteLines, margin + 14, y + 16);
    y += boxH + 18;
  }

  // ——— A-Frame / shell note ———
  if (summaryNote) {
    ensureSpace(40);
    const noteLines = doc.splitTextToSize(summaryNote, contentW);
    ink(C.mid);
    doc.setFont('times', 'italic');
    doc.setFontSize(10);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 13 + 18;
  }

  // ——— Next steps ———
  ensureSpace(90);
  sectionLabel('Next Steps');
  const steps = [
    'Review this specification and your selections.',
    `Reach us at ${contactEmail} to start the conversation.`,
    'Book a free consultation — we walk your land together.',
    'Confirm finishes, timeline and contract.',
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  steps.forEach((step, i) => {
    ensureSpace(18);
    ink(C.ink);
    doc.setFont('helvetica', 'bold');
    doc.text(`${i + 1}`, margin, y);
    ink(C.mid);
    doc.setFont('helvetica', 'normal');
    doc.text(step, margin + 16, y);
    y += 16;
  });

  // ——— Footer band on every page ———
  const drawFooter = () => {
    const fy = pageH - 54;
    stroke(C.border);
    doc.setLineWidth(0.7);
    doc.line(margin, fy, pageW - margin, fy);
    ink(C.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('DRIFT & DWELLS', margin, fy + 16, { charSpace: 1.5 });
    ink(C.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(C.tagline, margin, fy + 28);
    doc.text(`${contactEmail}   ·   ${C.website}`, pageW - margin, fy + 16, {
      align: 'right',
    });
  };

  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    drawFooter();
  }

  return doc;
}

export async function downloadBuildSpecPdf(state, contactEmail) {
  const doc = await createBuildSpecPdfDoc(state, contactEmail);
  const model = getBuildModel(state.modelId);
  const shortId = Math.random().toString(36).slice(2, 6).toUpperCase();
  const dateStamp = new Date().toISOString().slice(0, 10);
  const slug = model.name.replace(/[^a-z0-9]+/gi, '_');
  doc.save(`DriftDwells_Build_${slug}_${dateStamp}_${shortId}.pdf`);
}
