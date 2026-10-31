export const locations = [
  {
    id: "cabin",
    name: "The Cabin",
    tagline: "Unplug. Unwind. Disappear.",
    description: "Near Bachevo, in the Razlog area of southwestern Bulgaria, The Cabin is a testament to the beauty of subtraction. Formerly 'Bucephalus', this is a sanctuary for the over-connected.",
    price: "From €55/night",
    cta: "View The Cabin",
    details: {
      access: "Remote forest road; high clearance recommended",
      power: "Off-Grid (Solar/Gas - No Hair Dryers)",
      sleeps: "2 Guests (Queen Bed)",
      heat: "Indoor Fireplace + Gas Heater",
      highlight: "Shared Hot Tub (Wood-Fired)",
      wifi: "No WiFi",
      philosophy: "Dwell"
    },
    image: "/uploads/Content%20website/drift-dwells-bulgaria-bucephalus-suite.avif",
    interiorImage: "/uploads/Content%20website/drift-dwells-bulgaria-cabin-journal.avif",
    audioSrc: "/audio/Soyb - Mood (freetouse.com).mp3"
  },
  {
    id: "valley",
    name: "The Valley",
    tagline: "A Village Above the Clouds.",
    description: "The Valley currently offers five A-frame cabins, a private Luxury Cabin and a traditional Stone House, with accommodation for up to 18 guests.",
    price: "From €60/night",
    cta: "View The Valley",
    details: {
      access: "Normal car to Chereshovo parking; final ~2.5 km walk or arranged transfer",
      connectivity: "Starlink (Stone House Only)",
      altitude: "1,550m (Highest Inhabited Village in Balkans)",
      highlight: "Communal Stone House & shared outdoor spaces",
      wifi: "Starlink at Stone House",
      philosophy: "Drift"
    },
    image: "/uploads/The%20Valley/1760891828283-4dj2r5qvw0p-WhatsApp-Image-2025-10-14-at-2.05.18-PM-(3).jpeg",
    interiorImage: "/uploads/The%20Valley/1760891860480-135mocsa00t-WhatsApp-Image-2025-10-14-at-2.05.17-PM-(6).jpeg",
    audioSrc: "/audio/lit-fireplace-6307.mp3"
  }
];

export const philosophy = {
  title: "The Art of Aylyak",
  text: "We claim ownership of the Bulgarian concept of 'Aylyak'—a deliberate refusal to be rushed. The Valley is not just a place to sleep; it is a School of Aylyak.",
  description: "Aylyak represents deliberate slowness, presence over productivity, connection over connection, and ritual over routine. It's a conscious choice to move at nature's pace and be fully present in the moment."
};

export const contentPillars = {
  raw: {
    title: "The Raw",
    description: "Wilderness, mud, fire, texture."
  },
  drift: {
    title: "The Drift",
    description: "Movement, hiking, digital nomadism."
  },
  dwell: {
    title: "The Dwell",
    description: "Interiors, linen, coffee, 'Aylyak'."
  },
  myth: {
    title: "The Myth",
    description: "Orpheus, Perun, folklore."
  }
};

import LaurelIcon from '../components/icons/LaurelIcon';
import LeafIcon from '../components/icons/LeafIcon';
import WifiIcon from '../components/icons/WifiIcon';

export const home = {
  hero: {
    headline: "Drift into the Wild. Dwell in the Silence.",
    subhead: "Two distinct paths to the same peace. Choose your sanctuary in the heart of the Balkans."
  },
  mission: {
    title: "Handcrafted Stories",
    narrative: "We are not a hotel. We are a collection of hideaways designed for those who seek the edge of the map. Drift & Dwells was born from a simple duality: the urge to roam the untamed heights and the need to root oneself in raw, unvarnished comfort. Whether you crave the absolute, off-grid silence near Bachevo or the ethereal, high-altitude community of the Rhodope meadows, we offer the rarest amenity of all: presence."
  },
  trust: [
    { 
      icon: LaurelIcon, 
      title: "Guest favorite", 
      subtitle: "Rated 4.9/5" 
    },
    { 
      icon: LeafIcon, 
      title: "Eco-certified", 
      subtitle: "Sustainable stay" 
    },
    { 
      icon: WifiIcon, 
      title: "Starlink", 
      subtitle: "Stone House" 
    }
  ]
};

