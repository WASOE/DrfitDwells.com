import { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';

const ACCENT_RGB = [129, 136, 122];

const CONFIG_SCHEMA = {
  basePrice: 35000,
  categories: [
    {
      id: 'exterior',
      title: 'Exterior',
      description: 'Thermal wood exterior cladding.',
      type: 'radio',
      options: [
        {
          id: 'thermal-wood',
          name: 'Thermal wood cladding',
          description: 'Thermal wood exterior, ventilated grill system.',
          priceDelta: 0,
          included: true,
          media: ['exterior-hero'],
          specLines: ['Exterior cladding: thermal wood', 'Ventilation: wooden ventilated grill system']
        }
      ]
    },
    {
      id: 'roof',
      title: 'Roof',
      description: 'Weather-ready roof system.',
      type: 'radio',
      options: [
        {
          id: 'roof-standard',
          name: 'Waterproofing membrane',
          description: 'Standard waterproofing membrane roof build-up.',
          priceDelta: 0,
          included: true,
          media: ['exterior-roof'],
          specLines: ['Waterproofing membrane']
        }
      ]
    },
    {
      id: 'windows',
      title: 'Windows and doors',
      description: 'Glazing and entry configuration.',
      type: 'radio',
      options: [
        {
          id: 'double-glazed',
          name: 'Double-glazed windows',
          description: 'Standard double-glazed window set.',
          priceDelta: 0,
          included: true,
          media: ['exterior-windows'],
          specLines: ['Windows: double-glazed']
        }
      ]
    },
    {
      id: 'interior',
      title: 'Interior finish',
      description: 'Interior wall finish selection.',
      type: 'radio',
      options: [
        {
          id: 'plywood',
          name: 'Plywood finish',
          description: 'Clean plywood interior finish.',
          priceDelta: 0,
          included: true,
          media: ['interior-main'],
          specLines: ['Interior finish: plywood']
        },
        {
          id: 'planks',
          name: 'Wood planks finish',
          description: 'Warm wood planks interior finish.',
          priceDelta: 0,
          included: true,
          media: ['interior-planks'],
          specLines: ['Interior finish: wood planks']
        }
      ]
    },
    {
      id: 'systems',
      title: 'Systems and readiness',
      description: 'Utility connection readiness.',
      type: 'radio',
      options: [
        {
          id: 'utility-ready',
          name: 'Utility connections ready',
          description: 'Electricity, water, sewage connections pre-installed.',
          priceDelta: 0,
          included: true,
          media: ['systems-ready'],
          specLines: ['Utility readiness: pre-installed electricity, water, sewage connections']
        }
      ]
    }
  ]
};

const MEDIA_LIBRARY = {
  'exterior-hero': { id: 'exterior-hero', label: 'Exterior hero', view: 'exterior' },
  'exterior-roof': { id: 'exterior-roof', label: 'Roof detail', view: 'exterior' },
  'exterior-windows': { id: 'exterior-windows', label: 'Window detail', view: 'exterior' },
  'interior-main': { id: 'interior-main', label: 'Interior overview', view: 'interior' },
  'interior-planks': { id: 'interior-planks', label: 'Interior finish', view: 'interior' },
  'systems-ready': { id: 'systems-ready', label: 'Systems readiness', view: 'interior' }
};

const PRODUCT_FACTS = [
  { value: '7 m × 3 m × 3 m', label: 'External dimensions' },
  { value: '21 m²', label: 'Internal floor area' },
  { value: '2 persons', label: 'Designed capacity' },
  { value: 'Fully fitted', label: 'Bathroom + kitchenette' }
];

// Specs sourced from Description-of-our-mobile-cabin.pdf.
const MATERIALS_SPEC = {
  narrative: 'Designed for real use. Nothing decorative, nothing wasted.',
  specs: [
    'Exterior cladding: thermal wood',
    'Ventilation: wooden ventilated grill system',
    'Waterproofing membrane',
    'Insulation: mineral wool',
    'Vapor barrier',
    'Interior finish: plywood or planks',
    'Windows: double-glazed',
    'Utility readiness: pre-installed electricity, water, sewage connections'
  ]
};

const INCLUDED_SCOPE = [
  {
    title: 'Structure',
    items: ['Cabin structure', 'Insulation build-up', 'Windows']
  },
  {
    title: 'Systems readiness',
    items: ['Electricity connection', 'Water connection', 'Sewage connection']
  },
  {
    title: 'Fixed installations',
    items: ['Bathroom', 'Kitchenette']
  }
];

const GALLERY_ITEMS = [
  'Delivered cabin — exterior',
  'Delivered cabin — terrace',
  'Interior — living area',
  'Interior — kitchen',
  'Interior — bathroom',
  'Interior — sleeping area',
  'Winter delivery',
  'Forest placement',
  'Lakeside placement'
];

const FAQS = [
  {
    question: 'Is the cabin mobile and relocatable?',
    answer: 'Yes. The cabin is built as a mobile unit and can be relocated. Placement depends on site conditions.'
  },
  {
    question: 'What utility connections are included?',
    answer: 'Electrical, water, and sewage connections are pre-installed and ready for on-site connection.'
  },
  {
    question: 'Is it suitable for winter use?',
    answer: 'Mineral wool insulation and a vapor barrier are part of the construction. Seasonal performance depends on site conditions.'
  },
  {
    question: 'What warranty is provided?',
    answer: 'Warranty terms are defined in the build agreement.'
  },
  {
    question: 'What are the delivery requirements?',
    answer: 'Delivery is quoted separately based on location, access, and site requirements.'
  },
  {
    question: 'How does the payment schedule work?',
    answer: 'Payment milestones are outlined in the build agreement.'
  }
];

const PROOF_ITEMS = [
  { label: 'Airbnb rating', value: '4.95' },
  { label: 'Booking rating', value: '9.8' },
  { label: 'Built in Bulgaria. Dutch design.', value: 'Proven in our own rentals.' }
];

const SUMMARY_LABELS = {
  exterior: 'Exterior',
  roof: 'Roof',
  windows: 'Windows',
  interior: 'Interior',
  systems: 'Systems'
};

const formatPrice = (value) => new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0
}).format(value);

const trackEvent = (name, payload = {}) => {
  if (typeof window !== 'undefined' && window.dataLayer) {
    window.dataLayer.push({ event: name, ...payload });
  } else {
    console.log(`[analytics] ${name}`, payload);
  }
};

const MediaPlaceholder = ({ label, size = 'lg' }) => {
  const sizeClasses = size === 'lg'
    ? 'h-full w-full'
    : size === 'md'
      ? 'h-16 w-24'
      : 'h-24 w-full';

  return (
    <div className={`relative ${sizeClasses} overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#111]`}>
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#1c1c1c,transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),transparent_60%)]" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] uppercase tracking-[0.24em] text-[#bdbdbb]">{label}</span>
      </div>
    </div>
  );
};

const Build = () => {
  const initialSelections = {
    exterior: 'thermal-wood',
    roof: 'roof-standard',
    windows: 'double-glazed',
    interior: 'plywood',
    systems: 'utility-ready'
  };

  const [selections, setSelections] = useState(initialSelections);
  const [currentStep, setCurrentStep] = useState(0);
  const [mediaView, setMediaView] = useState('exterior');
  const [activeMediaId, setActiveMediaId] = useState('exterior-hero');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [lightboxItem, setLightboxItem] = useState(null);

  const categories = CONFIG_SCHEMA.categories;

  const selectedOptions = useMemo(() => {
    const result = {};
    categories.forEach(category => {
      const selected = category.options.find(option => option.id === selections[category.id]);
      result[category.id] = selected;
    });
    return result;
  }, [categories, selections]);

  const optionsTotal = useMemo(() => {
    let total = 0;
    categories.forEach(category => {
      const option = category.options.find(item => item.id === selections[category.id]);
      total += option?.priceDelta ?? 0;
    });
    return total;
  }, [categories, selections]);

  const totalPrice = CONFIG_SCHEMA.basePrice + optionsTotal;

  const buildSheet = useMemo(() => {
    const specByCategory = {};
    const summary = [];

    categories.forEach(category => {
      const option = category.options.find(item => item.id === selections[category.id]);
      specByCategory[category.title] = option?.specLines ?? [];
      summary.push({ label: SUMMARY_LABELS[category.id] || category.title, value: option?.name ?? 'On request' });
    });

    return {
      selections: selectedOptions,
      totals: {
        base: CONFIG_SCHEMA.basePrice,
        options: optionsTotal,
        total: totalPrice
      },
      specByCategory,
      summary,
      version: '2026.01',
      timestamp: new Date().toISOString()
    };
  }, [categories, optionsTotal, selections, selectedOptions, totalPrice]);

  const mediaOptions = Object.values(MEDIA_LIBRARY);
  const filteredMedia = mediaOptions.filter(media => media.view === mediaView);
  const fallbackMedia = filteredMedia.length
    ? filteredMedia
    : mediaOptions.filter(media => media.view === (mediaView === 'exterior' ? 'interior' : 'exterior'));
  const visibleMedia = fallbackMedia.length ? fallbackMedia : mediaOptions;

  useEffect(() => {
    if (!visibleMedia.length) {
      return;
    }
    const isActiveVisible = visibleMedia.some(media => media.id === activeMediaId);
    if (!isActiveVisible) {
      setActiveMediaId(visibleMedia[0].id);
    }
  }, [activeMediaId, visibleMedia]);

  useEffect(() => {
    if (!lightboxItem) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setLightboxItem(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxItem]);

  const handleMediaSelect = (mediaId) => {
    setActiveMediaId(mediaId);
  };

  const handleRadio = (categoryId) => (event) => {
    const value = event.target.value;
    setSelections(prev => ({ ...prev, [categoryId]: value }));
    const category = categories.find(item => item.id === categoryId);
    const option = category?.options.find(item => item.id === value);
    if (option?.media?.length) {
      const preferredMedia = option.media.find(id => MEDIA_LIBRARY[id]?.view === mediaView);
      const mediaId = preferredMedia || option.media[0];
      const view = MEDIA_LIBRARY[mediaId]?.view || 'exterior';
      setMediaView(view);
      setActiveMediaId(mediaId);
    }
    trackEvent('option_selected', { category: categoryId, option: value });
  };

  const handlePdfDownload = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 48;
    const contentWidth = 500;
    let y = margin;

    const setHeading = (text) => {
      doc.setTextColor(...ACCENT_RGB);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(text, margin, y);
      y += 16;
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
    };

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Drift & Dwells Mobile Cabin', margin, y);
    y += 24;
    doc.setFontSize(14);
    doc.text('Your Configuration', margin, y);
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, y);
    y += 20;

    doc.setDrawColor(25, 25, 25);
    doc.setFillColor(245, 245, 242);
    doc.rect(margin, y, 240, 140, 'F');
    doc.rect(margin + 260, y, 240, 140, 'F');
    doc.setTextColor(90, 90, 90);
    doc.text('Exterior render', margin + 12, y + 24);
    doc.text('Interior render', margin + 272, y + 24);
    doc.setTextColor(0, 0, 0);
    y += 160;

    setHeading('Configuration Summary');
    buildSheet.summary.forEach(item => {
      doc.text(`${item.label}: ${item.value}`, margin, y);
      y += 14;
    });
    y += 10;

    setHeading('Technical Specifications');
    const selectedSpecLines = Object.values(buildSheet.specByCategory).flat();
    const mergedSpecs = Array.from(new Set([
      ...MATERIALS_SPEC.specs,
      ...selectedSpecLines
    ]));
    mergedSpecs.forEach(line => {
      doc.text(`• ${line}`, margin, y, { maxWidth: contentWidth });
      y += 14;
      if (y > 720) {
        doc.addPage();
        y = margin;
      }
    });

    y += 12;
    setHeading('Price Summary');
    doc.text(`Base price: ${formatPrice(buildSheet.totals.base)}`, margin, y);
    y += 14;
    doc.text(`Options total: ${formatPrice(buildSheet.totals.options)}`, margin, y);
    y += 14;
    doc.text(`Total price: ${formatPrice(buildSheet.totals.total)}`, margin, y);
    y += 14;
    doc.text('Delivery: calculated separately', margin, y);
    y += 20;

    setHeading('Next Steps');
    doc.text('Request your build timeline at jose@driftdwells.com', margin, y, { maxWidth: contentWidth });

    const shortId = Math.random().toString(36).slice(2, 6).toUpperCase();
    const dateStamp = new Date().toISOString().slice(0, 10);
    const fileName = `DriftDwells_Cabin_Spec_${dateStamp}_${shortId}.pdf`;
    doc.save(fileName);
    trackEvent('pdf_downloaded', { total: buildSheet.totals.total });
  };

  return (
    <div className="bg-white text-[#1a1a1a]">
      <section className="pt-24 pb-12 lg:pt-32 lg:pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] gap-10 lg:gap-12 items-start">
            <div className="space-y-6">
              <div className="relative overflow-hidden rounded-3xl border border-[#1f1f1f] bg-[#0b0b0b]">
                <div className="aspect-[4/3] sm:aspect-[3/2] lg:aspect-[4/3]">
                  <MediaPlaceholder label={MEDIA_LIBRARY[activeMediaId]?.label || 'Exterior render'} />
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 bg-[#f8f7f4] rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em] w-fit">
                  <button
                    type="button"
                    onClick={() => setMediaView('exterior')}
                    className={`transition-colors ${mediaView === 'exterior' ? 'text-[#1a1a1a]' : 'text-[#6a6a6a]'}`}
                  >
                    Exterior
                  </button>
                  <span className="text-[#d6d6d3]">|</span>
                  <button
                    type="button"
                    onClick={() => setMediaView('interior')}
                    className={`transition-colors ${mediaView === 'interior' ? 'text-[#1a1a1a]' : 'text-[#6a6a6a]'}`}
                  >
                    Interior
                  </button>
                </div>

                <div className="flex gap-3 overflow-x-auto">
                  {visibleMedia.map(media => (
                    <button
                      key={media.id}
                      type="button"
                      onClick={() => handleMediaSelect(media.id)}
                      className={`h-16 w-24 overflow-hidden rounded-2xl border ${activeMediaId === media.id ? 'border-[#81887A]' : 'border-[#E5E5E0]'} bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A]`}
                      aria-label={`View ${media.label}`}
                    >
                      <MediaPlaceholder label={media.label} size="md" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:sticky lg:top-8">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[#6a6a6a]">Configurator</p>
                <h1 className="mt-3 font-['Montserrat'] text-3xl md:text-4xl lg:text-5xl font-semibold leading-[1.05]">
                  Build your off-grid mobile cabin
                </h1>
                <p className="mt-4 text-sm md:text-base text-[#4a4a4a] leading-[1.7] max-w-2xl">
                  Designed by Drift &amp; Dwells. Built for real use. Delivered ready to connect.
                </p>
              </div>

              <div id="configurator" className="mt-8 space-y-6">
                <div className="rounded-3xl border border-[#E5E5E0] p-6">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-[#6a6a6a]">
                    <span>Base price</span>
                    <span>{formatPrice(CONFIG_SCHEMA.basePrice)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-[#6a6a6a]">
                    <span>Options delta</span>
                    <span>{formatPrice(optionsTotal)}</span>
                  </div>
                  <div className="mt-4 text-xs uppercase tracking-[0.2em] text-[#6a6a6a]">Total price</div>
                  <div className="mt-1 text-3xl font-semibold">
                    {formatPrice(totalPrice)}
                  </div>
                  <div className="mt-2 text-sm text-[#6a6a6a]">Delivery calculated separately</div>
                </div>

                <div className="rounded-3xl border border-[#E5E5E0] p-6">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-[#6a6a6a]">
                    <span>Step {currentStep + 1} of {categories.length}</span>
                    <span className="text-[#81887A]">{categories[currentStep].title}</span>
                  </div>
                  <div className="mt-3 h-[2px] w-full bg-[#E5E5E0]">
                    <div
                      className="h-full bg-[#81887A]"
                      style={{ width: `${((currentStep + 1) / categories.length) * 100}%` }}
                    />
                  </div>

                  <div
                    className="mt-5 flex gap-2 overflow-x-auto pb-2 sticky top-20 bg-white/95 backdrop-blur-sm z-10 -mx-2 px-2 py-2"
                    role="tablist"
                    aria-label="Configurator steps"
                  >
                    {categories.map((category, index) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setCurrentStep(index)}
                        className={`whitespace-nowrap text-xs uppercase tracking-[0.2em] px-3 py-2 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] ${currentStep === index ? 'border-[#81887A] text-[#1a1a1a]' : 'border-[#E5E5E0] text-[#6a6a6a]'}`}
                        aria-label={`Step ${index + 1}: ${category.title}`}
                        role="tab"
                        aria-selected={currentStep === index}
                      >
                        {index + 1}. {category.title}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4">
                    {categories.map((category, index) => (
                      <div
                        key={category.id}
                        className={currentStep === index ? 'block' : 'hidden'}
                        role="tabpanel"
                        aria-label={`${category.title} options`}
                      >
                        <div className="text-xs uppercase tracking-[0.2em] text-[#6a6a6a]">{category.title}</div>
                        <p className="mt-2 text-sm text-[#4a4a4a]">{category.description}</p>

                        <div className="mt-4 space-y-3">
                          {category.options.map(option => (
                            <label
                              key={option.id}
                              className={`group flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-sm transition-colors ${option.id === selections[category.id] ? 'border-[#81887A] text-[#1a1a1a]' : 'border-[#E5E5E0] text-[#4a4a4a]'}`}
                            >
                              <span className="flex flex-col">
                                <span className="font-medium">{option.name}</span>
                                <span className="text-xs text-[#6a6a6a]">{option.description}</span>
                                <span className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[#6a6a6a]">
                                  {option.included ? 'Included' : `+ ${formatPrice(option.priceDelta)}`}
                                </span>
                              </span>
                              <input
                                type="radio"
                                name={category.id}
                                value={option.id}
                                checked={selections[category.id] === option.id}
                                onChange={handleRadio(category.id)}
                                className="h-4 w-4 text-[#81887A] focus-visible:ring-[#81887A]"
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-[#E5E5E0] p-6">
                  <div className="hidden lg:block">
                    <div className="text-xs uppercase tracking-[0.2em] text-[#6a6a6a]">Your build</div>
                    <div className="mt-3 space-y-1 text-[11px] uppercase tracking-[0.2em] text-[#6a6a6a]">
                      {buildSheet.summary.map(item => (
                        <div key={item.label}>{item.label}: {item.value}</div>
                      ))}
                      <div>Total: {formatPrice(buildSheet.totals.total)}</div>
                    </div>
                  </div>

                  <div className="lg:hidden">
                    <div className="rounded-2xl border border-[#E5E5E0] px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSummaryOpen(prev => !prev)}
                        className="w-full flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-[#6a6a6a]"
                        aria-expanded={summaryOpen}
                      >
                        <span>Your build</span>
                        <span>{summaryOpen ? 'Hide' : 'Show'}</span>
                      </button>
                      {summaryOpen && (
                        <div className="mt-3 space-y-1 text-[11px] uppercase tracking-[0.2em] text-[#6a6a6a]">
                          {buildSheet.summary.map(item => (
                            <div key={item.label}>{item.label}: {item.value}</div>
                          ))}
                          <div>Total: {formatPrice(buildSheet.totals.total)}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handlePdfDownload}
                    className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-[#1a1a1a] text-white px-5 py-3 text-xs uppercase tracking-[0.2em]"
                  >
                    Download your spec PDF
                  </button>
                  <a
                    href="mailto:jose@driftdwells.com"
                    onClick={() => trackEvent('timeline_requested')}
                    className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-[#1a1a1a] text-[#1a1a1a] px-5 py-3 text-xs uppercase tracking-[0.2em]"
                  >
                    Request build timeline
                  </a>
                  <a
                    href="https://driftdwells.com/wp-content/uploads/2024/06/Description-of-our-mobile-cabin.pdf"
                    className="mt-4 inline-block text-[12px] uppercase tracking-[0.2em] text-[#6a6a6a] hover:text-[#1a1a1a]"
                  >
                    Compare full specifications
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-8 md:py-10 border-t border-[#E5E5E0]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 text-sm text-[#4a4a4a]">
          {PROOF_ITEMS.map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-[#1a1a1a] font-semibold">{item.value}</span>
              <span className="uppercase tracking-[0.18em] text-[11px] text-[#6a6a6a]">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-10 text-center">
            {PRODUCT_FACTS.map((fact) => (
              <div key={fact.label} className="border border-[#E5E5E0] rounded-2xl px-4 py-6">
                <div className="text-2xl md:text-3xl font-semibold">{fact.value}</div>
                <div className="mt-2 text-[11px] uppercase tracking-[0.22em] text-[#6a6a6a]">{fact.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">
          <div>
            <h2 className="font-['Montserrat'] text-2xl md:text-3xl lg:text-4xl font-semibold mb-6">Materials &amp; construction</h2>
            <p className="text-sm md:text-base text-[#4a4a4a] mb-6 max-w-2xl">{MATERIALS_SPEC.narrative}</p>
          </div>
          <div className="space-y-4">
            <ul className="space-y-3 text-sm md:text-base text-[#4a4a4a]">
              {MATERIALS_SPEC.specs.map(item => (
                <li key={item} className="border-b border-[#E5E5E0] pb-3">{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="font-['Montserrat'] text-2xl md:text-3xl lg:text-4xl font-semibold mb-8">What’s included</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {INCLUDED_SCOPE.map(column => (
              <div key={column.title} className="space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-[#6a6a6a]">{column.title}</div>
                {column.items.map(item => (
                  <p key={item} className="text-sm md:text-base text-[#4a4a4a]">{item}</p>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-[#6a6a6a]">Foundation and transport depend on location.</p>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-6 mb-8">
            <h2 className="font-['Montserrat'] text-2xl md:text-3xl lg:text-4xl font-semibold">Delivered cabins</h2>
            <span className="text-[11px] uppercase tracking-[0.2em] text-[#6a6a6a]">Gallery</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {GALLERY_ITEMS.map(item => (
              <button
                key={item}
                type="button"
                onClick={() => setLightboxItem(item)}
                className="relative w-full overflow-hidden rounded-2xl"
                style={{ aspectRatio: '4 / 3' }}
                aria-label={`Open ${item}`}
              >
                <MediaPlaceholder label={item} size="sm" />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="font-['Montserrat'] text-2xl md:text-3xl lg:text-4xl font-semibold mb-8">Process &amp; timeline</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-8">
            {[
              'Configure',
              'Confirm and contract',
              'Build in workshop',
              'Delivery and handover'
            ].map((step, index) => (
              <div key={step} className="border border-[#E5E5E0] rounded-2xl p-6">
                <div className="text-xs uppercase tracking-[0.2em] text-[#6a6a6a]">Step {index + 1}</div>
                <p className="mt-3 text-sm md:text-base text-[#4a4a4a]">{step}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-[#6a6a6a]">Request a build timeline for current availability.</p>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="font-['Montserrat'] text-2xl md:text-3xl lg:text-4xl font-semibold mb-8">FAQ</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {FAQS.map((faq) => (
              <div key={faq.question} className="border border-[#E5E5E0] rounded-2xl p-6">
                <p className="text-sm font-semibold mb-3">{faq.question}</p>
                <p className="text-sm text-[#4a4a4a]">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16 border-t border-[#E5E5E0]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-8 items-center">
          <div>
            <h2 className="font-['Montserrat'] text-2xl md:text-3xl lg:text-4xl font-semibold">Ready to build yours?</h2>
            <p className="mt-3 text-sm md:text-base text-[#4a4a4a] max-w-2xl">
              Review your configuration and request a timeline or schedule a call to plan delivery.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row md:flex-col gap-4 md:items-start">
            <button
              type="button"
              onClick={handlePdfDownload}
              className="inline-flex items-center justify-center rounded-full bg-[#1a1a1a] text-white px-6 py-3 text-sm font-semibold tracking-[0.12em] uppercase"
            >
              Download your spec PDF
            </button>
            <a
              href="mailto:jose@driftdwells.com"
              onClick={() => trackEvent('call_scheduled_clicked')}
              className="inline-flex items-center justify-center rounded-full border border-[#1a1a1a] text-[#1a1a1a] px-6 py-3 text-sm font-semibold tracking-[0.12em] uppercase"
            >
              Schedule a call
            </a>
            <a
              href="https://driftdwells.com/wp-content/uploads/2024/06/Description-of-our-mobile-cabin.pdf"
              className="inline-block text-[12px] uppercase tracking-[0.2em] text-[#6a6a6a] hover:text-[#1a1a1a]"
            >
              Download full base specification (PDF)
            </a>
          </div>
        </div>
      </section>

      {lightboxItem && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
          <button
            type="button"
            onClick={() => setLightboxItem(null)}
            className="absolute top-6 right-6 text-white text-sm uppercase tracking-[0.2em]"
          >
            Close
          </button>
          <div className="w-full max-w-3xl px-6">
            <MediaPlaceholder label={lightboxItem} size="lg" />
          </div>
        </div>
      )}
    </div>
  );
};

export default Build;
