import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Seo from '../components/Seo';
import ConfiguratorHeader from '../components/configurator/ConfiguratorHeader';
import VisualizerCanvas from '../components/configurator/VisualizerCanvas';
import OptionSelector from '../components/configurator/OptionSelector';
import SpecsBar from '../components/configurator/SpecsBar';
import MobileConfigPanel from '../components/configurator/MobileConfigPanel';
import MobileStepIndicator from '../components/configurator/MobileStepIndicator';
import MobileSpecsBar from '../components/configurator/MobileSpecsBar';
import SocialProofRibbon from '../components/configurator/SocialProofRibbon';
import { useLanguage } from '../context/LanguageContext.jsx';

const ACCENT_RGB = [129, 136, 122];

// Reorganized into 4 steps as specified
const CONFIG_STEPS = [
  {
    id: 'exterior-shell',
    title: 'Exterior Shell',
    description: 'Select materials and construction types for the cabin exterior.',
    categories: ['exterior', 'roof', 'windows']
  },
  {
    id: 'interior-fitout',
    title: 'Interior Fit-out',
    description: 'Choose between fully fitted or custom interior finishes.',
    categories: ['interior']
  },
  {
    id: 'off-grid-systems',
    title: 'Off-Grid Systems',
    description: 'Configure off-grid mobile capabilities and utility connections.',
    categories: ['systems']
  },
  {
    id: 'delivery-timeline',
    title: 'Delivery & Timeline',
    description: 'Review your configuration and plan delivery.',
    categories: []
  }
];

const CONFIG_SCHEMA = {
  basePrice: 35000,
  categories: {
    exterior: {
      id: 'exterior',
      title: 'Exterior Cladding',
      description: 'Choose your exterior material and finish.',
      options: [
        {
          id: 'thermal-wood',
          name: 'Thermal wood cladding',
          description: 'Thermal wood exterior with ventilated grill system. Standard finish included.',
          priceDelta: 0,
          included: true,
          media: ['exterior-hero'],
          specLines: [
            'Exterior cladding: thermal wood',
            'Ventilation: wooden ventilated grill system',
            'Weather-resistant treatment'
          ]
        },
        {
          id: 'charred-wood',
          name: 'Shou sugi ban (charred wood)',
          description: 'Traditional Japanese charred wood finish for enhanced durability and distinctive appearance.',
          priceDelta: 2500,
          included: false,
          media: ['exterior-hero'],
          specLines: [
            'Exterior cladding: charred wood (Shou sugi ban)',
            'Ventilation: wooden ventilated grill system',
            'Fire-resistant treatment'
          ]
        },
        {
          id: 'metal-cladding',
          name: 'Metal cladding',
          description: 'Modern metal cladding option for contemporary aesthetic and low maintenance.',
          priceDelta: 3500,
          included: false,
          media: ['exterior-hero'],
          specLines: [
            'Exterior cladding: metal panels',
            'Ventilation: integrated system',
            'Corrosion-resistant finish'
          ]
        }
      ]
    },
    roof: {
      id: 'roof',
      title: 'Roof System',
      description: 'Select your roof configuration and waterproofing.',
      options: [
        {
          id: 'roof-standard',
          name: 'Waterproofing membrane',
          description: 'Standard waterproofing membrane roof build-up. Suitable for all climates.',
          priceDelta: 0,
          included: true,
          media: ['exterior-roof'],
          specLines: [
            'Waterproofing membrane',
            'Insulated roof structure',
            'Standard pitch'
          ]
        },
        {
          id: 'roof-green',
          name: 'Green roof option',
          description: 'Living green roof with drainage system. Adds insulation and ecological benefits.',
          priceDelta: 4500,
          included: false,
          media: ['exterior-roof'],
          specLines: [
            'Green roof system',
            'Drainage layer',
            'Sedum or native plants',
            'Enhanced insulation'
          ]
        },
        {
          id: 'roof-solar',
          name: 'Solar-ready roof',
          description: 'Reinforced roof structure ready for solar panel installation.',
          priceDelta: 2000,
          included: false,
          media: ['exterior-roof'],
          specLines: [
            'Solar-ready structure',
            'Pre-wired for panels',
            'Reinforced mounting points'
          ]
        }
      ]
    },
    windows: {
      id: 'windows',
      title: 'Windows & Doors',
      description: 'Configure glazing, doors, and natural light.',
      options: [
        {
          id: 'double-glazed',
          name: 'Double-glazed windows',
          description: 'Standard double-glazed window set. Energy efficient and standard throughout.',
          priceDelta: 0,
          included: true,
          media: ['exterior-windows'],
          specLines: [
            'Windows: double-glazed',
            'Standard aluminum frames',
            'Standard door configuration'
          ]
        },
        {
          id: 'triple-glazed',
          name: 'Triple-glazed windows',
          description: 'Premium triple-glazed windows for maximum insulation and energy efficiency.',
          priceDelta: 3200,
          included: false,
          media: ['exterior-windows'],
          specLines: [
            'Windows: triple-glazed',
            'Premium frames',
            'Enhanced thermal performance'
          ]
        },
        {
          id: 'large-windows',
          name: 'Large format windows',
          description: 'Expanded window openings for maximum natural light and views.',
          priceDelta: 2800,
          included: false,
          media: ['exterior-windows'],
          specLines: [
            'Large format glazing',
            'Minimal frame design',
            'Enhanced views'
          ]
        }
      ]
    },
    interior: {
      id: 'interior',
      title: 'Interior Finish',
      description: 'Choose your interior wall finish and aesthetic.',
      options: [
        {
          id: 'plywood',
          name: 'Plywood finish',
          description: 'Clean, modern plywood interior finish. Minimalist and contemporary.',
          priceDelta: 0,
          included: true,
          media: ['interior-main', 'interior-overview', 'interior-space'],
          specLines: [
            'Interior finish: plywood',
            'Natural wood grain',
            'Easy maintenance'
          ]
        },
        {
          id: 'planks',
          name: 'Wood planks finish',
          description: 'Warm wood planks interior finish. Traditional and cozy aesthetic.',
          priceDelta: 0,
          included: true,
          media: ['interior-planks', 'interior-detail', 'interior-bedroom'],
          specLines: [
            'Interior finish: wood planks',
            'Traditional appearance',
            'Natural warmth'
          ]
        },
        {
          id: 'white-wash',
          name: 'White-washed finish',
          description: 'Light white-washed wood finish for bright, airy interior spaces.',
          priceDelta: 1200,
          included: false,
          media: ['interior-main'],
          specLines: [
            'Interior finish: white-washed',
            'Light, bright aesthetic',
            'Enhanced light reflection'
          ]
        },
        {
          id: 'custom-finish',
          name: 'Custom finish',
          description: 'Work with our team to create a custom interior finish to match your vision.',
          priceDelta: 0,
          included: false,
          media: ['interior-main', 'interior-kitchen', 'interior-bathroom'],
          specLines: [
            'Interior finish: custom',
            'Consultation included',
            'Price quoted separately'
          ]
        }
      ]
    },
    systems: {
      id: 'systems',
      title: 'Off-Grid Systems',
      description: 'Configure utility connections and off-grid capabilities.',
      options: [
        {
          id: 'utility-ready',
          name: 'Utility connections ready',
          description: 'Standard utility connections pre-installed. Ready for on-site connection to grid.',
          priceDelta: 0,
          included: true,
          media: ['systems-ready'],
          specLines: [
            'Utility readiness: pre-installed electricity, water, sewage connections',
            'Standard grid connection',
            'Connection points ready'
          ]
        },
        {
          id: 'off-grid-solar',
          name: 'Off-grid solar system',
          description: 'Complete off-grid solar power system with battery storage. Independent energy solution.',
          priceDelta: 8500,
          included: false,
          media: ['systems-ready'],
          specLines: [
            'Solar panel system',
            'Battery storage',
            'Inverter and charge controller',
            'Fully independent power'
          ]
        },
        {
          id: 'composting-toilet',
          name: 'Composting toilet system',
          description: 'Eco-friendly composting toilet. No sewage connection required.',
          priceDelta: 2200,
          included: false,
          media: ['systems-ready'],
          specLines: [
            'Composting toilet',
            'No sewage connection needed',
            'Eco-friendly waste management'
          ]
        },
        {
          id: 'rainwater-system',
          name: 'Rainwater collection system',
          description: 'Integrated rainwater collection and filtration system.',
          priceDelta: 1800,
          included: false,
          media: ['systems-ready'],
          specLines: [
            'Rainwater collection',
            'Filtration system',
            'Storage tank',
            'Reduced water dependency'
          ]
        }
      ]
    }
  }
};

const MEDIA_LIBRARY = {
  'exterior-hero': { 
    id: 'exterior-hero', 
    label: 'Exterior hero', 
    view: 'exterior',
    image: '/uploads/The Valley/Lux Cabin/optimized/exterior-hero-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/exterior-hero-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/exterior-hero-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/exterior-hero-thumbnail.webp'
    }
  },
  'exterior-roof': { 
    id: 'exterior-roof', 
    label: 'Roof detail', 
    view: 'exterior',
    image: '/uploads/The Valley/Lux Cabin/optimized/exterior-roof-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/exterior-roof-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/exterior-roof-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/exterior-roof-thumbnail.webp'
    }
  },
  'exterior-windows': { 
    id: 'exterior-windows', 
    label: 'Window detail', 
    view: 'exterior',
    image: '/uploads/The Valley/Lux Cabin/optimized/exterior-windows-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/exterior-windows-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/exterior-windows-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/exterior-windows-thumbnail.webp'
    }
  },
  'interior-main': { 
    id: 'interior-main', 
    label: 'Interior overview', 
    view: 'interior',
    image: '/uploads/The Valley/Lux Cabin/optimized/interior-main-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/interior-main-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/interior-main-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/interior-main-thumbnail.webp'
    }
  },
  'interior-planks': { 
    id: 'interior-planks', 
    label: 'Interior finish', 
    view: 'interior',
    image: '/uploads/The Valley/Lux Cabin/optimized/interior-planks-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/interior-planks-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/interior-planks-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/interior-planks-thumbnail.webp'
    }
  },
  'interior-overview': { 
    id: 'interior-overview', 
    label: 'Interior overview', 
    view: 'interior',
    image: '/uploads/The Valley/Lux Cabin/optimized/interior-overview-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/interior-overview-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/interior-overview-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/interior-overview-thumbnail.webp'
    }
  },
  'interior-detail': { 
    id: 'interior-detail', 
    label: 'Interior detail', 
    view: 'interior',
    image: '/uploads/The Valley/Lux Cabin/optimized/interior-detail-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/interior-detail-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/interior-detail-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/interior-detail-thumbnail.webp'
    }
  },
  'interior-bathroom': { 
    id: 'interior-bathroom', 
    label: 'Bathroom', 
    view: 'interior',
    image: '/uploads/The Valley/Lux Cabin/optimized/interior-bathroom-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/interior-bathroom-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/interior-bathroom-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/interior-bathroom-thumbnail.webp'
    }
  },
  'interior-kitchen': { 
    id: 'interior-kitchen', 
    label: 'Kitchen', 
    view: 'interior',
    image: '/uploads/The Valley/Lux Cabin/optimized/interior-kitchen-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/interior-kitchen-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/interior-kitchen-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/interior-kitchen-thumbnail.webp'
    }
  },
  'interior-bedroom': { 
    id: 'interior-bedroom', 
    label: 'Bedroom', 
    view: 'interior',
    image: '/uploads/The Valley/Lux Cabin/optimized/interior-bedroom-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/interior-bedroom-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/interior-bedroom-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/interior-bedroom-thumbnail.webp'
    }
  },
  'interior-lighting': { 
    id: 'interior-lighting', 
    label: 'Interior lighting', 
    view: 'interior',
    image: '/uploads/The Valley/Lux Cabin/optimized/interior-lighting-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/interior-lighting-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/interior-lighting-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/interior-lighting-thumbnail.webp'
    }
  },
  'interior-space': { 
    id: 'interior-space', 
    label: 'Living space', 
    view: 'interior',
    image: '/uploads/The Valley/Lux Cabin/optimized/interior-space-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/interior-space-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/interior-space-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/interior-space-thumbnail.webp'
    }
  },
  'interior-window': { 
    id: 'interior-window', 
    label: 'Window view', 
    view: 'interior',
    image: '/uploads/The Valley/Lux Cabin/optimized/interior-window-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/interior-window-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/interior-window-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/interior-window-thumbnail.webp'
    }
  },
  'exterior-angle': { 
    id: 'exterior-angle', 
    label: 'Exterior angle', 
    view: 'exterior',
    image: '/uploads/The Valley/Lux Cabin/optimized/exterior-angle-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/exterior-angle-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/exterior-angle-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/exterior-angle-thumbnail.webp'
    }
  },
  'systems-ready': { 
    id: 'systems-ready', 
    label: 'Systems readiness', 
    view: 'interior',
    image: '/uploads/The Valley/Lux Cabin/optimized/systems-ready-desktop.webp',
    images: {
      desktop: '/uploads/The Valley/Lux Cabin/optimized/systems-ready-desktop.webp',
      mobile: '/uploads/The Valley/Lux Cabin/optimized/systems-ready-mobile.webp',
      thumbnail: '/uploads/The Valley/Lux Cabin/optimized/systems-ready-thumbnail.webp'
    }
  }
};

// Complete cabin specifications
const CABIN_SPECS = {
  dimensions: {
    external: '7 m × 3 m × 3 m',
    internal: '21 m²',
    height: '3 m',
    width: '3 m',
    length: '7 m'
  },
  capacity: {
    persons: 2,
    beds: '1 Queen bed',
    description: 'Designed for 2 persons'
  },
  construction: {
    structure: 'Mobile unit, relocatable',
    insulation: 'Mineral wool insulation',
    vaporBarrier: 'Vapor barrier included',
    foundation: 'Foundation quoted separately based on site'
  },
  included: {
    structure: [
      'Cabin structure',
      'Insulation build-up (mineral wool)',
      'Vapor barrier',
      'Windows (double-glazed standard)',
      'Doors'
    ],
    systems: [
      'Electricity connection points',
      'Water connection points',
      'Sewage connection points',
      'All connections pre-installed'
    ],
    installations: [
      'Bathroom (fully fitted)',
      'Kitchenette (fully fitted)',
      'Interior lighting',
      'Basic electrical outlets'
    ]
  },
  materials: {
    exterior: 'Thermal wood cladding (standard)',
    roof: 'Waterproofing membrane',
    insulation: 'Mineral wool',
    interior: 'Plywood or wood planks (your choice)',
    windows: 'Double-glazed (standard)',
    doors: 'Standard entry door'
  },
  delivery: {
    timeline: '8-12 weeks from confirmation',
    process: [
      'Configure your cabin',
      'Confirm and contract',
      'Build in workshop (Bulgaria)',
      'Delivery and handover'
    ],
    note: 'Delivery quoted separately based on location, access, and site requirements'
  }
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
  const [isMobileConfigOpen, setIsMobileConfigOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isSpecsBarExpanded, setIsSpecsBarExpanded] = useState(false);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);
  const configPanelRef = useRef(null);
  const { language } = useLanguage();

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Calculate current categories (moved before useEffect that uses it)
  const currentStepData = CONFIG_STEPS[currentStep];
  const currentCategories = currentStepData.categories.map(catId => CONFIG_SCHEMA.categories[catId]).filter(Boolean);

  // Check if config panel is scrollable and show indicator (throttled for performance)
  useEffect(() => {
    const checkScrollable = () => {
      if (configPanelRef.current && !isMobile) {
        const { scrollHeight, clientHeight } = configPanelRef.current;
        setShowScrollIndicator(scrollHeight > clientHeight);
      }
    };

    let scrollTimeout;
    const handleScroll = () => {
      // Throttle scroll events to reduce performance impact
      if (scrollTimeout) return;
      
      scrollTimeout = requestAnimationFrame(() => {
        const panel = configPanelRef.current;
        if (panel && !isMobile) {
          const isAtBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 10;
          setShowScrollIndicator(!isAtBottom);
        }
        scrollTimeout = null;
      });
    };

    // Initial check
    checkScrollable();
    
    const panel = configPanelRef.current;
    if (panel && !isMobile) {
      panel.addEventListener('scroll', handleScroll, { passive: true });
      window.addEventListener('resize', checkScrollable, { passive: true });
    }

    return () => {
      if (scrollTimeout) {
        cancelAnimationFrame(scrollTimeout);
      }
      if (panel) {
        panel.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', checkScrollable);
    };
  }, [isMobile, currentStep]);

  const totalPrice = useMemo(() => {
    let total = CONFIG_SCHEMA.basePrice;
    Object.values(selections).forEach(selectedId => {
      // Find option and add priceDelta
      Object.values(CONFIG_SCHEMA.categories).forEach(category => {
        const option = category.options.find(opt => opt.id === selectedId);
        if (option) {
          total += option.priceDelta || 0;
        }
      });
    });
    return total;
  }, [selections]);

  const formatPrice = (value) => new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0
  }).format(value);

  const handleOptionSelect = (categoryId, optionId) => {
    setSelections(prev => ({ ...prev, [categoryId]: optionId }));
    
    // Update media view based on selection - triggers cross-fade animation
    const category = CONFIG_SCHEMA.categories[categoryId];
    const option = category?.options.find(opt => opt.id === optionId);
    if (option?.media?.length) {
      const mediaId = option.media[0];
      const media = MEDIA_LIBRARY[mediaId];
      if (media) {
        setMediaView(media.view);
        // Trigger cross-fade by updating activeMediaId
        setActiveMediaId(mediaId);
      }
    }
  };

  const handleNextStep = () => {
    if (currentStep < CONFIG_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleStepClick = (stepIndex) => {
    setCurrentStep(stepIndex);
    if (isMobile) {
      setIsMobileConfigOpen(true);
    }
  };

  // Auto-open config panel when step changes on mobile
  useEffect(() => {
    if (isMobile && isMobileConfigOpen === false && currentStep >= 0) {
      // Don't auto-open, let user click the button
    }
  }, [currentStep, isMobile, isMobileConfigOpen]);

  const deliveryContent = [
    { step: 1, title: 'Configure', desc: 'Select your options' },
    { step: 2, title: 'Confirm & Contract', desc: 'Finalize agreement' },
    { step: 3, title: 'Build in Workshop', desc: 'Handcrafted construction in Bulgaria' },
    { step: 4, title: 'Delivery & Handover', desc: 'Ready to connect at your site' }
  ];

  const handlePdfDownload = useCallback(async () => {
    // Lazy load jsPDF only when needed
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 48;
    const contentWidth = 500;
    let y = margin;

    // Helper function for headings
    const setHeading = (text, size = 12) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(size);
      doc.setTextColor(0, 0, 0);
      doc.text(text, margin, y);
      y += size + 4;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
    };

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Drift & Dwells Mobile Cabin', margin, y);
    y += 24;
    doc.setFontSize(14);
    doc.text('Your Configuration Specification', margin, y);
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    })}`, margin, y);
    y += 20;

    // Price Summary
    setHeading('Price Summary', 12);
    doc.setTextColor(0, 0, 0);
    doc.text(`Base Price: ${formatPrice(CONFIG_SCHEMA.basePrice)}`, margin, y);
    y += 14;
    
    let optionsTotal = 0;
    Object.entries(selections).forEach(([categoryId, optionId]) => {
      const category = CONFIG_SCHEMA.categories[categoryId];
      const option = category?.options.find(opt => opt.id === optionId);
      if (option && option.priceDelta > 0) {
        optionsTotal += option.priceDelta;
        doc.text(`${option.name}: +${formatPrice(option.priceDelta)}`, margin + 20, y);
        y += 14;
      }
    });
    
    if (optionsTotal > 0) {
      doc.text(`Options Total: ${formatPrice(optionsTotal)}`, margin, y);
      y += 14;
    }
    
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Price: ${formatPrice(totalPrice)}`, margin, y);
    y += 20;

    // Configuration Details
    setHeading('Your Configuration', 12);
    Object.entries(selections).forEach(([categoryId, optionId]) => {
      const category = CONFIG_SCHEMA.categories[categoryId];
      const option = category?.options.find(opt => opt.id === optionId);
      if (option) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(`${category.title}:`, margin, y);
        y += 14;
        doc.setFont('helvetica', 'normal');
        doc.text(`  ${option.name}`, margin + 10, y);
        y += 14;
        if (option.specLines && option.specLines.length > 0) {
          option.specLines.forEach(line => {
            doc.text(`  • ${line}`, margin + 10, y, { maxWidth: contentWidth - 20 });
            y += 14;
          });
        }
        y += 8;
      }
    });

    // Technical Specifications
    if (y > 650) {
      doc.addPage();
      y = margin;
    }
    setHeading('Technical Specifications', 12);
    doc.text(`External Dimensions: ${CABIN_SPECS.dimensions.external}`, margin, y);
    y += 14;
    doc.text(`Internal Floor Area: ${CABIN_SPECS.dimensions.internal}`, margin, y);
    y += 14;
    doc.text(`Capacity: ${CABIN_SPECS.capacity.description}`, margin, y);
    y += 14;
    doc.text(`Structure: ${CABIN_SPECS.construction.structure}`, margin, y);
    y += 14;
    doc.text(`Insulation: ${CABIN_SPECS.construction.insulation}`, margin, y);
    y += 20;

      // Included Items
      setHeading("What's Included", 12);
    CABIN_SPECS.included.structure.forEach(item => {
      doc.text(`• ${item}`, margin, y);
      y += 14;
    });
    y += 8;
    CABIN_SPECS.included.systems.forEach(item => {
      doc.text(`• ${item}`, margin, y);
      y += 14;
    });
    y += 8;
    CABIN_SPECS.included.installations.forEach(item => {
      doc.text(`• ${item}`, margin, y);
      y += 14;
    });
    y += 20;

    // Delivery Note
    if (y > 650) {
      doc.addPage();
      y = margin;
    }
    setHeading('Delivery & Timeline', 12);
    doc.text(`Estimated Timeline: ${CABIN_SPECS.delivery.timeline}`, margin, y);
    y += 14;
    doc.text('Process:', margin, y);
    y += 14;
    CABIN_SPECS.delivery.process.forEach((step, index) => {
      doc.text(`${index + 1}. ${step}`, margin + 10, y);
      y += 14;
    });
    y += 10;
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(CABIN_SPECS.delivery.note, margin, y, { maxWidth: contentWidth });
    y += 20;

    // Next Steps
    if (y > 650) {
      doc.addPage();
      y = margin;
    }
    setHeading('Next Steps', 12);
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text('To proceed with your cabin build:', margin, y);
    y += 20;
    doc.text('1. Review this specification', margin, y);
    y += 14;
    doc.text('2. Contact us at info@driftdwells.com', margin, y);
    y += 14;
    doc.text('3. Schedule a design consultation', margin, y);
    y += 14;
    doc.text('4. Finalize contract and timeline', margin, y);

    const shortId = Math.random().toString(36).slice(2, 6).toUpperCase();
    const dateStamp = new Date().toISOString().slice(0, 10);
    const fileName = `DriftDwells_Cabin_Spec_${dateStamp}_${shortId}.pdf`;
    doc.save(fileName);
  }, [selections, totalPrice]);

  // Memoize media options to prevent recalculation
  const mediaOptions = useMemo(() => Object.values(MEDIA_LIBRARY), []);
  const visibleMedia = useMemo(() => 
    mediaOptions.filter(media => media.view === mediaView),
    [mediaOptions, mediaView]
  );
  const seoTitle =
    language === 'bg'
      ? 'Модулни къщи Drift & Dwells – оф-грид домове (~30 000 €)'
      : 'Custom Modular Cabins Bulgaria – Drift & Dwells';
  const seoDescription =
    language === 'bg'
      ? 'Искате собствена оф-грид къща? Проектираме и доставяме напълно обзаведени модулни домове в България (от около 30 000 €). Холандски дизайн, готови за живеене.'
      : 'Design your own off-grid cabin: turnkey modular timber homes in Bulgaria from around €30,000, Dutch-designed and furnished. Configure finishes and systems here.';

  return (
    <>
      <Seo
        title={seoTitle}
        description={seoDescription}
        canonicalPath="/build"
        noindex
      />
      <div className="min-h-screen bg-white">
        {/* Header - Desktop only, mobile uses step indicator */}
        <div className="hidden lg:block">
          <ConfiguratorHeader />
        </div>

      {/* Mobile Step Indicator */}
      <MobileStepIndicator
        steps={CONFIG_STEPS}
        currentStep={currentStep}
        onStepClick={handleStepClick}
      />

      {/* Mobile: Full-screen Visualizer with Configure Button */}
      <div className="lg:hidden relative">
        <div className="fixed inset-0 top-16 bottom-24 z-0" style={{ zIndex: 0 }}>
          <VisualizerCanvas
            activeMediaId={activeMediaId}
            mediaView={mediaView}
            selections={selections}
            onMediaSelect={setActiveMediaId}
            onMediaViewChange={setMediaView}
            visibleMedia={visibleMedia}
            allMedia={mediaOptions}
            isMobile={true}
          />
        </div>

        {/* Floating Configure Button - Hide when config panel is open OR specs bar is expanded */}
        <AnimatePresence>
          {!isMobileConfigOpen && !isSpecsBarExpanded && (
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20, transition: { duration: 0.2 } }}
              onClick={() => {
                setIsMobileConfigOpen(true);
              }}
              className="fixed left-1/2 transform -translate-x-1/2 px-8 py-4 bg-black text-white rounded-full text-sm uppercase tracking-wider font-medium shadow-2xl touch-manipulation active:scale-95"
              style={{ 
                zIndex: 30, // Below thumbnails (z-40) but above specs bar
                bottom: '180px' // Position well above thumbnail strip (~60px height) and specs bar
              }}
            >
              Configure Cabin
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Desktop: Majestic Split-screen layout: 70/30 */}
      <section className="hidden lg:block relative min-h-screen overflow-hidden">
        <div className="flex flex-row h-screen">
          
          {/* Left 70% - Visualizer (sticky, visual bleed) */}
          <div className="w-[70%] relative overflow-hidden">
            <div className="sticky top-0 h-screen left-0">
              <VisualizerCanvas
                activeMediaId={activeMediaId}
                mediaView={mediaView}
                selections={selections}
                onMediaSelect={setActiveMediaId}
                onMediaViewChange={setMediaView}
                visibleMedia={visibleMedia}
                allMedia={mediaOptions}
                isMobile={false}
              />
            </div>
          </div>

          {/* Right 30% - Configuration Panel (scrollable with backdrop blur) */}
          <div 
            ref={configPanelRef}
            className="w-[30%] overflow-y-auto bg-white backdrop-blur-sm lg:backdrop-blur-md pb-40 relative"
          >
            {/* Gradient fade at bottom to indicate scrollability */}
            {showScrollIndicator && (
              <div 
                className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none z-10"
                style={{
                  background: 'linear-gradient(to top, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.85) 30%, rgba(255, 255, 255, 0.4) 70%, transparent 100%)'
                }}
              />
            )}
            
            <div className="px-8 py-8 relative z-0">
              {/* Slim progress line at top */}
              <div className="mb-8">
                <div className="h-0.5 bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${((currentStep + 1) / CONFIG_STEPS.length) * 100}%` }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    className="h-full bg-black rounded-full"
                  />
                </div>
                <div className="mt-2 text-xs uppercase tracking-[0.2em] text-gray-600 font-medium">
                  Step {currentStep + 1} of {CONFIG_STEPS.length}
                </div>
              </div>

              <div className="space-y-6">
                <AnimatePresence mode="wait">
                  {currentStep < 3 ? (
                    <motion.div
                      key={currentStep}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.4 }}
                    >
                      {currentCategories.map((category) => (
                        <OptionSelector
                          key={category.id}
                          category={category}
                          selectedOptionId={selections[category.id]}
                          onSelect={(optionId) => handleOptionSelect(category.id, optionId)}
                          stepIndex={currentStep}
                          totalSteps={CONFIG_STEPS.length}
                        />
                      ))}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="delivery"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="backdrop-blur-xl bg-white/80 rounded-2xl border border-gray-200 shadow-2xl p-8"
                    >
                      <h3 className="text-3xl font-light text-black mb-4">
                        Delivery & Timeline
                      </h3>
                      <p className="text-base text-gray-600 mb-6 font-light">
                        Review your configuration and plan delivery.
                      </p>
                      
                      <div className="space-y-4 mb-8">
                        {deliveryContent.map((item) => (
                          <div key={item.step} className="flex items-start gap-4 p-4 rounded-xl bg-gray-50 border border-gray-200">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-medium">
                              {item.step}
                            </div>
                            <div>
                              <div className="font-medium text-black mb-1">{item.title}</div>
                              <div className="text-sm text-gray-600 font-light">{item.desc}</div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-4">
                        <button
                          onClick={handlePdfDownload}
                          className="w-full px-6 py-4 bg-black text-white rounded-full text-sm uppercase tracking-wider font-medium hover:bg-gray-900 transition-colors"
                        >
                          Download Your Spec PDF
                        </button>
                        <a
                          href="mailto:info@driftdwells.com?subject=Cabin Configuration Consultation"
                          className="block w-full px-6 py-4 border border-black text-black rounded-full text-sm uppercase tracking-wider font-medium hover:bg-black hover:text-white transition-colors text-center"
                        >
                          Schedule a Design Consultation
                        </a>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Mobile Configuration Panel (Bottom Sheet) */}
      <MobileConfigPanel
        isOpen={isMobileConfigOpen}
        onClose={() => setIsMobileConfigOpen(false)}
        currentStep={currentStep}
        totalSteps={CONFIG_STEPS.length}
        currentCategories={currentCategories}
        selections={selections}
        onOptionSelect={handleOptionSelect}
        onNextStep={handleNextStep}
        onPrevStep={handlePrevStep}
        canGoNext={currentStep < CONFIG_STEPS.length - 1}
        canGoPrev={currentStep > 0}
        isDeliveryStep={currentStep === 3}
        deliveryContent={deliveryContent}
        onDownloadPDF={handlePdfDownload}
        onScheduleConsultation={() => window.location.href = 'mailto:info@driftdwells.com?subject=Cabin Configuration Consultation'}
      />

      {/* Social Proof Ribbon */}
      <div className="hidden lg:block">
        <SocialProofRibbon />
      </div>

      {/* Desktop Specs Bar */}
      <div className="hidden lg:block">
        <SpecsBar
          dimensions="7 m × 3 m × 3 m"
          area="21 m²"
          capacity="2 Persons"
          price={formatPrice(totalPrice)}
          onDownloadPDF={handlePdfDownload}
          onScheduleConsultation={() => window.location.href = 'mailto:info@driftdwells.com?subject=Cabin Configuration Consultation'}
        />
      </div>

      {/* Mobile Specs Bar */}
      <MobileSpecsBar
        dimensions="7 m × 3 m × 3 m"
        area="21 m²"
        capacity="2 Persons"
        price={formatPrice(totalPrice)}
        onDownloadPDF={handlePdfDownload}
        onScheduleConsultation={() => window.location.href = 'mailto:info@driftdwells.com?subject=Cabin Configuration Consultation'}
        isConfigPanelOpen={isMobileConfigOpen}
        onExpandedChange={setIsSpecsBarExpanded}
      />
      </div>
    </>
  );
};

export default Build;
