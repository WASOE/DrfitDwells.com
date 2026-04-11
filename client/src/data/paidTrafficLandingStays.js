/**
 * Paid-traffic landing: routing + media only. Copy lives in i18n (`seo` → paidStaysBulgaria).
 */

export const PAID_TRAFFIC_STAY_META = [
  {
    id: 'the-cabin',
    linkKind: 'primary',
    detailsPath: '/cabin',
    image: '/uploads/Content%20website/drift-dwells-bulgaria-bucephalus-suite.avif',
    imagePath: '/uploads/Content website/drift-dwells-bulgaria-bucephalus-suite.avif',
    showDetailsLink: true
  },
  {
    id: 'valley-a-frame',
    linkKind: 'route',
    route: '/stays/a-frame',
    detailsPath: '/stays/a-frame',
    image: '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.24%20AM%20(4).jpeg',
    imagePath: '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM (4).jpeg',
    showDetailsLink: false
  },
  {
    id: 'valley-stone-house',
    linkKind: 'backend',
    backendName: 'Stone House',
    detailsPath: '/valley',
    detailsHash: 'accommodations',
    image: '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.24%20AM.jpeg',
    imagePath: '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM.jpeg',
    showDetailsLink: true
  },
  {
    id: 'valley-lux-cabin',
    linkKind: 'backend',
    backendName: 'Lux Cabin',
    detailsPath: '/valley',
    detailsHash: 'accommodations',
    image: '/uploads/The%20Valley/Lux-cabin-exterior-watermark-remover-20260113071503.jpg',
    imagePath: '/uploads/The Valley/Lux-cabin-exterior-watermark-remover-20260113071503.jpg',
    showDetailsLink: true
  }
];
