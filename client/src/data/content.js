export const locations = [
  {
    id: "cabin",
    name: "The Cabin",
    tagline: "Unplug. Unwind. Disappear.",
    description: "Nestled in the rugged folds of the Pirin Mountains, The Cabin is a testament to the beauty of subtraction. Formerly 'Bucephalus', this is a sanctuary for the over-connected.",
    price: "From €120/night",
    cta: "View The Cabin",
    details: {
      access: "3km Rugged Trail (SUV/Jeep Required)",
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
    description: "Suspended between earth and sky at 1,550m. A collection of 13 A-frames and a communal Stone House designed for the modern drifter.",
    price: "From €145/night",
    cta: "View The Valley",
    details: {
      access: "Jeep, ATV, or Horseback Transfer",
      connectivity: "Starlink (Stone House Only)",
      altitude: "1,550m (Highest Inhabited Village in Balkans)",
      highlight: "Communal Stone House & Coworking",
      wifi: "Starlink Available",
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
    narrative: "We are not a hotel. We are a collection of hideaways designed for those who seek the edge of the map. Drift & Dwells was born from a simple duality: the urge to roam the untamed heights and the need to root oneself in raw, unvarnished comfort. Whether you crave the absolute, off-grid silence of the Pirin forests or the ethereal, high-altitude community of the Rhodope meadows, we offer the rarest amenity of all: presence."
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
      subtitle: "150 Mbps" 
    }
  ]
};

