/**
 * Admin-only defaults for guide / arrival / transport (Valley ops).
 * Does not include listing essentials (name, description, location, capacity, pricing).
 */

export const VALLEY_GUIDE_ARRIVAL_PRESET = {
  transportOptions: [
    {
      type: 'Jeep',
      pricePerPerson: 25,
      description: '4x4 transfer from Chereshovo to the Valley',
      duration: '25 minutes',
      isAvailable: true
    },
    {
      type: 'Horse',
      pricePerPerson: 40,
      description: 'Guided horse ride into the Valley',
      duration: '90 minutes',
      isAvailable: true
    },
    {
      type: 'Hike',
      pricePerPerson: 0,
      description: 'Marked hiking route to the Valley',
      duration: '2.5 hours',
      isAvailable: true
    }
  ],
  meetingPoint: {
    label: '',
    googleMapsUrl: '',
    what3words: '',
    lat: '',
    lng: ''
  },
  arrivalGuideUrl: '/guides/the-valley',
  packingListText: [
    'Warm layers for cool evenings',
    'Sturdy shoes for valley paths',
    'Torch or headlamp',
    'Reusable water bottle',
    'Power bank (solar power is limited)'
  ].join('\n'),
  emergencyContact: '',
  arrivalWindowDefault: '',
  safetyNotes: '',
  transportCutoffs: []
};
