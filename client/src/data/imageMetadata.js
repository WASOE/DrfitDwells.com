/**
 * Comprehensive Image Metadata Database
 * 
 * Purpose:
 * 1. Provide detailed context for AI to understand exactly what each image contains
 * 2. Enable precise image selection based on content (e.g., "front of stone house" vs "valley landscape")
 * 3. Optimize SEO with descriptive alt text and structured data
 * 
 * Structure:
 * - location: 'cabin' | 'valley' | 'generic'
 * - subject: Specific building/feature shown
 * - content: Detailed description of what's in the image
 * - perspective: Interior/exterior/view type
 * - seo: SEO-optimized alt text and description
 * - tags: Array of searchable tags
 */

export const imageMetadata = {
  // ============================================
  // THE CABIN (Bachevo) - Images
  // ============================================
  cabin: {
    // Content Website Images
    '/uploads/Content%20website/drift-dwells-bulgaria-bucephalus-suite.avif': {
      location: 'cabin',
      subject: 'The Cabin (Bucephalus)',
      perspective: 'interior',
      content: 'Interior view of the main living space showing wooden walls, queen bed, warm lighting, cozy rustic cabin atmosphere',
      seo: {
        alt: 'Interior of Bucephalus cabin showing rustic wooden walls, queen bed, and warm ambient lighting in off-grid mountain cabin near Bachevo, Rhodope Mountains, Bulgaria',
        title: 'Bucephalus Cabin Interior - Rustic Off-Grid Mountain Cabin',
        description: 'The main living space of the Bucephalus cabin, showcasing rustic wooden interior, comfortable queen bed, and the cozy atmosphere of this off-grid mountain retreat near Bachevo in the Rhodope Mountains.'
      },
      tags: ['interior', 'bedroom', 'living-space', 'wooden-walls', 'rustic', 'bucephalus', 'main-room'],
      useCases: ['cabin-hero', 'cabin-interior-showcase', 'cabin-lifestyle', 'booking-card']
    },
    
    '/uploads/Content%20website/drift-dwells-bulgaria-cabin-journal.avif': {
      location: 'cabin',
      subject: 'The Cabin (Bucephalus)',
      perspective: 'interior',
      content: 'Close-up interior detail showing a journal, reading nook, or cozy writing space with natural lighting',
      seo: {
        alt: 'Cozy reading nook with journal and natural lighting inside Bucephalus off-grid cabin, Rhodope Mountains, Bulgaria',
        title: 'Cabin Reading Nook - Cozy Interior Detail at Bucephalus',
        description: 'A peaceful reading and writing space inside the Bucephalus cabin, featuring natural lighting, wooden surfaces, and the quiet atmosphere perfect for journaling and reflection.'
      },
      tags: ['interior', 'reading-nook', 'journal', 'cozy', 'details', 'writing-space', 'natural-light'],
      useCases: ['cabin-interior-detail', 'lifestyle', 'homepage-polaroid', 'content-marketing']
    },

    '/uploads/Content%20website/drift-dwells-bulgaria-cabin-path.png': {
      location: 'cabin',
      subject: 'Path to The Cabin',
      perspective: 'exterior',
      content: 'Wooden path or trail leading through forest to the cabin, showing approach route through nature',
      seo: {
        alt: 'Wooden forest path leading to Bucephalus off-grid cabin through pine trees, Rhodope Mountains, Bulgaria',
        title: 'Forest Path to Bucephalus Cabin - Nature Trail Approach',
        description: 'The scenic wooden path that winds through the pine forest, leading guests to the secluded Bucephalus cabin near Bachevo. This trail showcases the natural beauty and peaceful approach to the off-grid mountain retreat.'
      },
      tags: ['exterior', 'path', 'trail', 'forest', 'approach', 'nature', 'wooden-path'],
      useCases: ['cabin-approach', 'nature-scenery', 'journey-to-cabin', 'landscape']
    },

    '/uploads/Content%20website/drift-dwells-bulgaria-rainy-eaves.avif': {
      location: 'cabin',
      subject: 'The Cabin (Bucephalus)',
      perspective: 'exterior',
      content: 'Exterior view of cabin in rain showing eaves, roof structure, and atmospheric rainy weather',
      seo: {
        alt: 'Exterior view of Bucephalus cabin roof and eaves during rainy weather, showing rustic wooden structure in forest setting, Rhodope Mountains',
        title: 'Cabin Exterior in Rain - Rustic Roof Details at Bucephalus',
        description: 'The atmospheric exterior of the Bucephalus cabin during rainfall, showcasing the rustic wooden roof structure, eaves, and the cozy shelter it provides in the Rhodope Mountain forest.'
      },
      tags: ['exterior', 'roof', 'eaves', 'rain', 'weather', 'atmosphere', 'wooden-structure'],
      useCases: ['cabin-exterior', 'weather-atmosphere', 'rustic-details', 'seasonal-content']
    },

    '/uploads/Content%20website/drift-dwells-bulgaria-fern-study.png': {
      location: 'cabin',
      subject: 'Nature Around Cabin',
      perspective: 'exterior',
      content: 'Detailed botanical study or illustration of ferns and forest flora near the cabin',
      seo: {
        alt: 'Fern and forest flora botanical study near Bucephalus cabin, showing natural Rhodope Mountain vegetation',
        title: 'Forest Flora Near Cabin - Botanical Study of Mountain Ferns',
        description: 'A detailed botanical illustration showing the native ferns and forest vegetation that surrounds the Bucephalus cabin, highlighting the rich biodiversity of the Rhodope Mountain ecosystem.'
      },
      tags: ['nature', 'botanical', 'ferns', 'flora', 'forest', 'vegetation', 'illustration'],
      useCases: ['nature-detail', 'botanical-content', 'illustration', 'artistic']
    },

    '/uploads/Content%20website/drift-dwells-bulgaria-lake-dawn.png': {
      location: 'cabin',
      subject: 'Lake/Nature Scene',
      perspective: 'landscape',
      content: 'Dawn or early morning landscape showing lake, mist, and natural scenery near cabin area',
      seo: {
        alt: 'Dawn landscape with misty lake and forest near Bachevo in Rhodope Mountains, Bulgaria, showing peaceful morning atmosphere',
        title: 'Dawn Lake View Near Cabin - Misty Mountain Morning Landscape',
        description: 'A serene dawn landscape near the Bucephalus cabin area, featuring a misty lake, surrounding forest, and the peaceful morning atmosphere of the Rhodope Mountains at first light.'
      },
      tags: ['landscape', 'dawn', 'morning', 'lake', 'mist', 'nature', 'scenery', 'atmosphere'],
      useCases: ['nature-landscape', 'atmosphere', 'time-of-day', 'scenic-view']
    },

    // Direct Cabin Folder Images (Bucephalus - All confirmed Cabin images)
    '/uploads/The Cabin/': {
      location: 'cabin',
      subject: 'The Cabin (Bucephalus)',
      note: 'All 57 images in this folder are confirmed Bucephalus cabin images showing various interior and exterior views',
      categories: {
        interior: 'Bedroom, living space, kitchen, bathroom, reading nooks, wooden interiors',
        exterior: 'Cabin exterior, roof, structure, forest setting, approach paths',
        lifestyle: 'Guests using space, daily activities, cozy moments',
        details: 'Close-ups of furniture, decor, textures, natural elements'
      },
      seo: {
        alt: 'Bucephalus off-grid cabin',
        baseDescription: 'Authentic images of the Bucephalus off-grid mountain cabin near Bachevo, Rhodope Mountains, Bulgaria'
      },
      useCases: ['cabin-gallery', 'cabin-details-page', 'booking-presentation', 'lifestyle-content']
    }
  },

  // ============================================
  // THE VALLEY (Chereshovo/Ortsevo) - Images
  // ============================================
  valley: {
    // Direct Valley Folder Images
    '/uploads/The Valley/1760891828283-4dj2r5qvw0p-WhatsApp-Image-2025-10-14-at-2.05.18-PM-(3).jpeg': {
      location: 'valley',
      subject: 'Panoramic Swing or Valley Feature',
      perspective: 'exterior',
      content: '⚠️ NEEDS VERIFICATION: Image showing panoramic swing area or valley feature - NOT the Stone House front. Shows swing set, mountain view, and valley landscape.',
      seo: {
        alt: 'Panoramic swing area at The Valley with mountain landscape view, 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Panoramic Swing at The Valley - Mountain View Feature',
        description: 'A panoramic swing area at The Valley offering breathtaking views of the mountain landscape at 1,550m altitude in the Rhodope Mountains.'
      },
      tags: ['swing', 'panoramic', 'exterior', 'valley-feature', 'mountain-view', 'landscape', 'outdoor', '1-550m'],
      useCases: ['valley-features', 'outdoor-spaces', 'panoramic-view', 'landscape'],
      note: '⚠️ DO NOT USE FOR STONE HOUSE - This shows a swing/viewpoint, not the Stone House front exterior'
    },

    '/uploads/The Valley/1760891856097-tkq4ums108j-WhatsApp-Image-2025-10-14-at-2.05.18-PM.jpeg': {
      location: 'valley',
      subject: 'Panoramic Swing at The Valley',
      perspective: 'exterior',
      content: 'Panoramic swing area at The Valley showing swing set with mountain landscape view. Outdoor feature offering breathtaking valley and mountain views at 1,550m altitude.',
      seo: {
        alt: 'Panoramic swing at The Valley with mountain landscape view, 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Panoramic Swing - Mountain View Feature at The Valley',
        description: 'The panoramic swing area at The Valley offering breathtaking views of the mountain landscape and valley below at 1,550m altitude in the Rhodope Mountains - a perfect spot to relax and enjoy the scenery.'
      },
      tags: ['swing', 'panoramic', 'exterior', 'valley-feature', 'mountain-view', 'landscape', 'outdoor', '1-550m'],
      useCases: ['valley-features', 'outdoor-spaces', 'panoramic-view', 'landscape', 'valley-amenities']
    },

    '/uploads/The Valley/1760891860480-135mocsa00t-WhatsApp-Image-2025-10-14-at-2.05.17-PM-(6).jpeg': {
      location: 'valley',
      subject: 'Outdoor Seating Area with Cabin',
      perspective: 'exterior',
      content: 'Exterior view showing small dark-roofed cabin or house nestled among trees. Outdoor seating area in foreground with four chairs around small table. Green landscape with dense forest in background. Some trees display autumn colors.',
      seo: {
        alt: 'Outdoor seating area with cabin at The Valley showing four chairs around table and forest backdrop at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Outdoor Seating Area - Cabin with Forest Backdrop at The Valley',
        description: 'An exterior view at The Valley showing an outdoor seating area with four chairs around a small table in the foreground, a small dark-roofed cabin nestled among trees, and a dense forest backdrop with autumn colors at 1,550m altitude.'
      },
      tags: ['outdoor-seating', 'exterior', 'chairs', 'table', 'cabin', 'forest-backdrop', 'autumn', '1-550m'],
      useCases: ['outdoor-spaces', 'seating-area', 'cabin-showcase', 'landscape']
    },

    // NOTE: Image 1760891864528 was renamed - now using Lux-cabin- prefix images
    // Old reference kept for backward compatibility but should use new Lux-cabin- images
    '/uploads/The Valley/1760891864528-oo96olwh9l-WhatsApp-Image-2025-10-14-at-2.05.17-PM-(1).jpeg': {
      location: 'valley',
      subject: 'Luxury Cabin Interior - Modern Plywood Design (Legacy Reference)',
      perspective: 'interior',
      content: 'LEGACY REFERENCE - This image has been renamed. Use Lux-cabin- prefix images instead. Interior view of Luxury Cabin showing modern interior with plywood walls, large windows, and contemporary design.',
      seo: {
        alt: 'Luxury cabin interior at The Valley showing modern plywood walls and large windows at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Luxury Cabin Interior - Modern Plywood Design with Large Windows',
        description: 'The modern interior of the Luxury Cabin at The Valley, featuring plywood walls, large windows offering panoramic mountain views, contemporary design, and full comfort with heating and modern amenities at 1,550m altitude.'
      },
      tags: ['luxury-cabin', 'interior', 'modern', 'plywood-walls', 'large-windows', 'contemporary', 'legacy', '1-550m'],
      useCases: ['luxury-cabin-interior', 'accommodation-showcase', 'modern-interior', 'comfort-features']
    },

    // NEW VALLEY IMAGES - October 2025
    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM (1).jpeg': {
      location: 'valley',
      subject: 'Stone House Front Exterior',
      perspective: 'exterior',
      content: 'Front exterior view of the Stone House showing stone walls on lower level, wooden siding on upper level, blue roof with solar panels, and wooden deck. Historic accommodation perfect for families and groups at The Valley.',
      seo: {
        alt: 'Stone House front exterior at The Valley showing stone and wood construction, blue roof with solar panels, and wooden deck at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Stone House - Historic Family Accommodation in The Valley',
        description: 'The front exterior of the historic Stone House at The Valley, featuring traditional stone construction on the lower level, wooden siding above, a distinctive blue roof with solar panels, and a welcoming wooden deck, located at 1,550m altitude in the Rhodope Mountains - perfect for families and small groups.'
      },
      tags: ['stone-house', 'exterior', 'front', 'historic', 'stone-walls', 'wooden-siding', 'solar-panels', 'deck', 'family-accommodation', '1-550m'],
      useCases: ['stone-house-portal', 'valley-accommodations', 'historic-building', 'accommodation-showcase', 'booking-presentation', 'family-stays']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM (2).jpeg': {
      location: 'valley',
      subject: 'Stone House and A-Frames Panoramic View',
      perspective: 'exterior',
      content: 'Wide exterior view showing the Stone House (stone walls, blue roof) in foreground, with multiple A-frame cabins visible on the grassy hillside in the background. Panoramic view of The Valley village layout.',
      seo: {
        alt: 'Panoramic view of The Valley showing Stone House and multiple A-frame cabins on grassy hillside at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'The Valley Village Layout - Stone House and A-Frame Cabins Panoramic View',
        description: 'A panoramic exterior view of The Valley village showing the historic Stone House in the foreground and multiple geometric A-frame cabins scattered across the grassy hillside, showcasing the unique mountain village layout at 1,550m altitude.'
      },
      tags: ['stone-house', 'a-frames', 'panoramic', 'village-layout', 'exterior', 'hillside', 'valley-view', '1-550m'],
      useCases: ['valley-overview', 'village-layout', 'accommodation-showcase', 'panoramic-view']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM.jpeg': {
      location: 'valley',
      subject: 'The Valley Panoramic Landscape',
      perspective: 'landscape',
      content: 'Panoramic landscape view of The Valley showing Stone House in distance, multiple A-frame cabins on grassy terrain, and dense forest backdrop. Wide view of the mountain village setting.',
      seo: {
        alt: 'Panoramic landscape view of The Valley mountain village showing Stone House, A-frame cabins, and forest backdrop at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'The Valley Panoramic Landscape - Mountain Village Overview',
        description: 'A breathtaking panoramic landscape view of The Valley showing the Stone House in the distance, multiple geometric A-frame cabins scattered across the grassy terrain, all set against a dense forest backdrop at 1,550m altitude in the Rhodope Mountains.'
      },
      tags: ['panoramic', 'landscape', 'valley-view', 'stone-house', 'a-frames', 'village', 'forest', '1-550m'],
      useCases: ['valley-hero', 'landscape-overview', 'village-showcase', 'panoramic-view']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM (1).jpeg': {
      location: 'valley',
      subject: 'Aerial View of Stone House',
      perspective: 'aerial',
      content: 'Top-down aerial view of the Stone House showing blue roof, clearing around the building, and dirt paths. High-angle perspective of the historic building.',
      seo: {
        alt: 'Aerial top-down view of Stone House at The Valley showing blue roof and surrounding paths at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Aerial View of Stone House - Top-Down Perspective',
        description: 'An aerial top-down view of the historic Stone House at The Valley, showcasing the distinctive blue roof, the clearing around the building, and the dirt paths connecting to other accommodations at 1,550m altitude.'
      },
      tags: ['aerial', 'stone-house', 'top-down', 'blue-roof', 'paths', '1-550m'],
      useCases: ['aerial-view', 'stone-house-showcase', 'village-map', 'layout-explanation']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM (2).jpeg': {
      location: 'valley',
      subject: 'Fire Pit Area Aerial View',
      perspective: 'aerial',
      content: 'Aerial view showing circular stone fire pit surrounded by chairs on grassy hillside. High-angle view of communal outdoor gathering space with trees and rolling hills in background.',
      seo: {
        alt: 'Aerial view of fire pit area at The Valley showing stone fire pit, chairs, and grassy hillside at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Fire Pit Area - Aerial View of Communal Gathering Space',
        description: 'An aerial view of the communal fire pit area at The Valley, featuring a circular stone fire pit surrounded by outdoor chairs on a grassy hillside, with trees and rolling hills in the background at 1,550m altitude.'
      },
      tags: ['aerial', 'fire-pit', 'communal', 'outdoor', 'gathering-space', 'stone-fire-pit', 'chairs', '1-550m'],
      useCases: ['fire-pit-showcase', 'communal-spaces', 'outdoor-gathering', 'aerial-view']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM (4).jpeg': {
      location: 'valley',
      subject: 'A-Frame Cabin Exterior',
      perspective: 'exterior',
      content: 'Exterior view of A-frame cabin showing natural wood construction, dark front door, metal chimney pipe extending from peak, and surrounding trees. Distinctive triangular architecture perfect for minimalist mountain stays.',
      seo: {
        alt: 'A-frame cabin exterior at The Valley showing natural wood construction, front door, and chimney at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Cabin - Minimalist Mountain Accommodation',
        description: 'An exterior view of an A-frame cabin at The Valley, showcasing the natural wood construction, dark front door, metal chimney pipe extending from the peak, and the surrounding forest setting at 1,550m altitude - perfect for minimalist mountain stays.'
      },
      tags: ['a-frame', 'exterior', 'wood-construction', 'chimney', 'front-door', 'geometric', 'minimalist', 'mountain-stay', '1-550m'],
      useCases: ['a-frame-showcase', 'architecture-highlight', 'accommodation-showcase', 'exterior-view', 'minimalist-stay']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM (5).jpeg': {
      location: 'valley',
      subject: 'A-Frame Cabins Valley View',
      perspective: 'landscape',
      content: 'High-angle landscape view showing multiple A-frame cabins scattered across grassy valley. Wide view of The Valley village with forest backdrop and rolling terrain.',
      seo: {
        alt: 'Valley view showing multiple A-frame cabins across grassy terrain at The Valley, 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Cabins Valley View - Village Layout Landscape',
        description: 'A high-angle landscape view of The Valley showing multiple geometric A-frame cabins scattered across the grassy valley terrain, showcasing the village layout with a dense forest backdrop at 1,550m altitude.'
      },
      tags: ['a-frames', 'valley-view', 'landscape', 'village-layout', 'grassy-terrain', 'multiple-cabins', '1-550m'],
      useCases: ['valley-overview', 'village-layout', 'a-frame-showcase', 'landscape-view']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM (6).jpeg': {
      location: 'valley',
      subject: 'A-Frame Cabin Exterior with Sunset',
      perspective: 'exterior',
      content: 'Exterior view of A-frame cabin showing triangular wooden structure with dark entrance and chimney, set against trees and warm sunset or dusk lighting. Atmospheric evening view.',
      seo: {
        alt: 'A-frame cabin exterior at sunset at The Valley showing triangular structure, trees, and warm evening light at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Cabin at Sunset - Evening Atmosphere',
        description: 'An atmospheric exterior view of an A-frame cabin at The Valley during sunset, featuring the distinctive triangular wooden structure with dark entrance and chimney, set against a forest backdrop with warm evening lighting at 1,550m altitude.'
      },
      tags: ['a-frame', 'exterior', 'sunset', 'evening', 'atmospheric', 'warm-light', 'trees', '1-550m'],
      useCases: ['a-frame-showcase', 'evening-atmosphere', 'lifestyle', 'sunset-view']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM (7).jpeg': {
      location: 'valley',
      subject: 'Fire Pit Area Ground View',
      perspective: 'exterior',
      content: 'Ground-level view of communal fire pit area showing circular stone fire pit surrounded by outdoor chairs (blue and grey) on dry grass. Close-up view of gathering space with trees in background.',
      seo: {
        alt: 'Ground view of fire pit area at The Valley showing stone fire pit and outdoor chairs at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Fire Pit Area - Communal Gathering Space Ground View',
        description: 'A ground-level view of the communal fire pit area at The Valley, showing the circular stone fire pit surrounded by comfortable outdoor chairs (blue and grey) on dry grass, with trees in the background at 1,550m altitude.'
      },
      tags: ['fire-pit', 'communal', 'outdoor', 'gathering-space', 'chairs', 'stone-fire-pit', 'ground-view', '1-550m'],
      useCases: ['fire-pit-showcase', 'communal-spaces', 'outdoor-gathering', 'ground-view']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.24 AM.jpeg': {
      location: 'valley',
      subject: 'Stone House with Deck and A-Frames',
      perspective: 'exterior',
      content: 'Exterior view showing modern house with dark roof, light walls, and extensive wooden deck wrapping around it. Multiple A-frame cabins visible in background field. Stone House or main building view.',
      seo: {
        alt: 'Stone House with wooden deck and A-frame cabins in background at The Valley, 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Stone House with Deck - Main Building and Village View',
        description: 'An exterior view of the Stone House (or main building) at The Valley, featuring dark roof, light walls, and an extensive wooden deck wrapping around the building, with multiple A-frame cabins visible in the background field at 1,550m altitude.'
      },
      tags: ['stone-house', 'exterior', 'deck', 'wooden-deck', 'a-frames-background', 'main-building', '1-550m'],
      useCases: ['stone-house-showcase', 'deck-area', 'village-view', 'accommodation-showcase']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.25 AM (2).jpeg': {
      location: 'valley',
      subject: 'The Valley Panoramic A-Frame View',
      perspective: 'landscape',
      content: 'Panoramic landscape view showing multiple A-frame cabins scattered across lush green valley. Wide view of The Valley village with dense forest and rolling hills in background under cloudy sky.',
      seo: {
        alt: 'Panoramic view of The Valley showing multiple A-frame cabins across green valley at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'The Valley Panoramic View - A-Frame Village Landscape',
        description: 'A panoramic landscape view of The Valley showing multiple geometric A-frame cabins scattered across the lush green valley terrain, with dense forest and rolling hills forming the backdrop under a cloudy sky at 1,550m altitude.'
      },
      tags: ['panoramic', 'a-frames', 'valley-view', 'landscape', 'green-valley', 'village', 'forest', '1-550m'],
      useCases: ['valley-hero', 'panoramic-view', 'village-showcase', 'landscape-overview']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.25 AM (4).jpeg': {
      location: 'valley',
      subject: 'Stone House Interior - Rustic Lounge',
      perspective: 'interior',
      content: 'Interior view of Stone House showing rough stone walls, wooden plank ceiling, wooden ladder, large wooden barrel, sofa with shaggy light fabric, dark ottoman, small window, and hanging light fixture. Rustic cozy space.',
      seo: {
        alt: 'Stone House interior at The Valley showing rustic stone walls, wooden ceiling, sofa, and cozy lounge area at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Stone House Interior - Rustic Lounge with Stone Walls',
        description: 'A cozy interior view of the Stone House at The Valley, featuring rough stone walls, wooden plank ceiling, comfortable seating with shaggy fabric sofa and ottoman, wooden ladder and barrel accents, and rustic lighting at 1,550m altitude.'
      },
      tags: ['stone-house', 'interior', 'rustic', 'stone-walls', 'wooden-ceiling', 'lounge', 'sofa', 'cozy', '1-550m'],
      useCases: ['stone-house-interior', 'rustic-interior', 'lounge-area', 'accommodation-showcase']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.25 AM (5).jpeg': {
      location: 'valley',
      subject: 'Dog in Valley Landscape',
      perspective: 'landscape',
      content: 'Outdoor view showing large dark brown dog (Newfoundland or similar breed) lying on dry yellowish-green grass. Dense pine forest in background under bright clear sky. Natural valley setting.',
      seo: {
        alt: 'Dog in natural valley landscape at The Valley showing pine forest backdrop at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Pet-Friendly Valley - Dog in Natural Mountain Setting',
        description: 'A natural outdoor scene at The Valley showing a large dog resting on the dry grass in the valley setting, with a dense pine forest forming the backdrop under a bright clear sky at 1,550m altitude - showcasing the pet-friendly natural environment.'
      },
      tags: ['dog', 'pet-friendly', 'landscape', 'pine-forest', 'outdoor', 'natural-setting', 'valley', '1-550m'],
      useCases: ['pet-friendly', 'lifestyle', 'natural-setting', 'valley-atmosphere']
    },

    '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.25 AM (6).jpeg': {
      location: 'valley',
      subject: 'Stone House Interior with Dog',
      perspective: 'interior',
      content: 'Interior view of Stone House showing dark brown dog lying on rustic wooden floor. Rough stone walls, cozy seating area created from stacked hay bales against wall, dark doorway opening in background, and warm soft lighting. Cozy rustic atmosphere.',
      seo: {
        alt: 'Stone House interior with dog at The Valley showing rustic stone walls and cozy hay bale seating at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Pet-Friendly Stone House Interior - Rustic Cozy Space',
        description: 'A cozy interior view of the Stone House at The Valley showing a dog resting on the rustic wooden floor, featuring rough stone walls, a unique seating area created from stacked hay bales, and warm soft lighting at 1,550m altitude - showcasing the pet-friendly rustic interior.'
      },
      tags: ['stone-house', 'interior', 'dog', 'pet-friendly', 'rustic', 'stone-walls', 'hay-bales', 'cozy', '1-550m'],
      useCases: ['stone-house-interior', 'pet-friendly', 'rustic-interior', 'lifestyle']
    },

    // NEW VALLEY IMAGES - November 2025
    '/uploads/The Valley/WhatsApp Image 2025-11-19 at 5.08.50 PM (1).jpeg': {
      location: 'valley',
      subject: 'A-Frame Bathroom - Rustic Sink',
      perspective: 'interior',
      content: 'Interior view of rustic bathroom showing thick rough-hewn wooden countertop with round metallic basin sink. Round mirror with wooden frame above, white wall-mounted water heater, and small vase with pink flowers on counter. Rustic A-frame bathroom design.',
      seo: {
        alt: 'Rustic bathroom in A-frame cabin at The Valley showing wooden counter, metal basin sink, and vintage-style fixtures at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Bathroom - Rustic Sink and Vintage Design',
        description: 'A rustic bathroom interior in an A-frame cabin at The Valley, featuring a thick rough-hewn wooden countertop with a round metallic basin sink, wooden-framed mirror, wall-mounted water heater, and decorative flowers - showcasing the unique vintage-style bathroom design at 1,550m altitude.'
      },
      tags: ['a-frame', 'bathroom', 'interior', 'rustic', 'wooden-counter', 'metal-sink', 'vintage-style', '1-550m'],
      useCases: ['a-frame-interior', 'bathroom-showcase', 'rustic-design', 'accommodation-features']
    },

    '/uploads/The Valley/WhatsApp Image 2025-11-19 at 5.08.50 PM.jpeg': {
      location: 'valley',
      subject: 'A-Frame Bathroom - Modern Clean Design',
      perspective: 'interior',
      content: 'Interior view of modern clean bathroom showing white ceramic toilet, small round woven basket on floor, toilet brush holder, wooden shelf mounted on wall above toilet with potted plant, and light-colored tiled floor. Modern minimalist design.',
      seo: {
        alt: 'Modern bathroom in A-frame cabin at The Valley showing clean design, white toilet, and decorative plants at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Bathroom - Modern Clean Design with Natural Elements',
        description: 'A modern, clean bathroom interior in an A-frame cabin at The Valley, featuring a white ceramic toilet, decorative woven basket, wooden wall shelf with potted plants, and light-colored tiles - showcasing the blend of modern amenities with natural design elements at 1,550m altitude.'
      },
      tags: ['a-frame', 'bathroom', 'interior', 'modern', 'clean-design', 'white-toilet', 'plants', 'minimalist', '1-550m'],
      useCases: ['a-frame-interior', 'bathroom-showcase', 'modern-design', 'accommodation-features']
    },

    // NEW VALLEY IMAGES - December 2025
    '/uploads/The Valley/Lux-cabin-WhatsApp Image 2025-12-03 at 1.36.11 PM.jpeg': {
      location: 'valley',
      subject: 'Cozy A-Frame Interior with Fire',
      perspective: 'interior',
      content: 'Interior view of A-frame cabin showing couple and golden retriever sitting on floor wrapped in patterned blanket near black wood-burning stove with glowing fire. Light wood paneling, dark grey kitchen cabinets, string lights on ceiling, and black stovepipe. Warm cozy atmosphere.',
      seo: {
        alt: 'Cozy A-frame interior at The Valley showing wood-burning stove, couple with dog, and warm atmosphere at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Cozy A-Frame Interior - Wood-Burning Stove and Warm Atmosphere',
        description: 'A cozy interior view of an A-frame cabin at The Valley, featuring a glowing black wood-burning stove, a couple with their golden retriever wrapped in a warm blanket, light wood paneling, kitchen cabinets, and string lights creating a warm atmosphere at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'wood-burning-stove', 'cozy', 'couple', 'dog', 'string-lights', 'warm-atmosphere', '1-550m'],
      useCases: ['a-frame-interior', 'lifestyle', 'cozy-atmosphere', 'wood-stove', 'pet-friendly']
    },


    '/uploads/The Valley/WhatsApp Image 2025-12-03 at 4.36.15 PM (1).jpeg': {
      location: 'valley',
      subject: 'A-Frame Cabins with Campfire',
      perspective: 'landscape',
      content: 'Wide outdoor view showing cluster of three wooden A-frame cabins in grassy clearing surrounded by pine forest. Campfire burning in foreground with smoke rising. Several people gathered around campfire. Glamping experience scene.',
      seo: {
        alt: 'A-frame cabins with campfire at The Valley showing group gathering and mountain forest setting at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Village with Campfire - Group Gathering Experience',
        description: 'A wide outdoor view of The Valley showing three A-frame cabins clustered in a grassy clearing surrounded by pine forest, with a campfire burning in the foreground and people gathered around - showcasing the communal glamping experience at 1,550m altitude.'
      },
      tags: ['a-frames', 'campfire', 'group-gathering', 'landscape', 'pine-forest', 'glamping', 'communal', 'outdoor', '1-550m'],
      useCases: ['valley-overview', 'group-experience', 'campfire', 'communal-gathering', 'glamping']
    },

    // NEW FIREPLACE IMAGES - January 2026
    '/uploads/The Valley/-03e7a985-8967-4a35-9169-36206d128506.png': {
      location: 'valley',
      subject: 'Communal Fireplace - Evening Gathering',
      perspective: 'exterior',
      content: 'Evening view of communal fireplace area showing glowing fire, outdoor gathering space, and warm atmosphere. People gathered around fireplace creating cozy evening ambiance at The Valley.',
      seo: {
        alt: 'Communal fireplace evening gathering at The Valley showing glowing fire and warm atmosphere at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Evening Fireplace Gathering - Communal Fire Pit at The Valley',
        description: 'An evening view of the communal fireplace area at The Valley, featuring a glowing fire, outdoor gathering space, and people gathered around creating a warm, cozy evening ambiance at 1,550m altitude in the Rhodope Mountains.'
      },
      tags: ['fireplace', 'fire-pit', 'evening', 'communal', 'gathering', 'warm-atmosphere', 'outdoor', 'glowing-fire', '1-550m'],
      useCases: ['fireplace-showcase', 'evening-gathering', 'communal-spaces', 'warm-atmosphere', 'lifestyle']
    },

    '/uploads/The Valley/-9ab13c37-ccb4-4a5d-b0f7-6ac0978d50bb.png': {
      location: 'valley',
      subject: 'Communal Fireplace - Cozy Evening',
      perspective: 'exterior',
      content: 'Cozy evening view of communal fireplace showing active fire, comfortable outdoor seating area, and intimate gathering space. Warm firelight creating inviting atmosphere for evening relaxation.',
      seo: {
        alt: 'Cozy evening at communal fireplace at The Valley showing active fire and comfortable seating at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Cozy Evening Fireplace - Communal Gathering Space',
        description: 'A cozy evening view of the communal fireplace at The Valley, featuring an active fire, comfortable outdoor seating area, and an intimate gathering space with warm firelight creating an inviting atmosphere for evening relaxation at 1,550m altitude.'
      },
      tags: ['fireplace', 'fire-pit', 'evening', 'cozy', 'communal', 'gathering', 'warm-firelight', 'outdoor-seating', 'intimate', '1-550m'],
      useCases: ['fireplace-showcase', 'evening-atmosphere', 'communal-spaces', 'cozy-gathering', 'lifestyle']
    },

    '/uploads/The Valley/WhatsApp Image 2025-12-03 at 4.36.15 PM.jpeg': {
      location: 'valley',
      subject: 'Couple at Campfire with A-Frames',
      perspective: 'exterior',
      content: 'Outdoor view showing couple standing near small table with campfire in front. Two A-frame cabins visible in background. Grassy area within forest, bright sky overhead. Couple engaged in activity, possibly preparing food or drinks.',
      seo: {
        alt: 'Couple at campfire near A-frame cabins at The Valley showing outdoor dining experience at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Outdoor Campfire Experience - Couple at The Valley',
        description: 'An outdoor view of a couple enjoying a campfire experience at The Valley, with a small table and fire in the foreground, two A-frame cabins visible in the background, all set in a grassy forest setting under a bright sky at 1,550m altitude.'
      },
      tags: ['campfire', 'couple', 'outdoor-dining', 'a-frames-background', 'lifestyle', 'forest-setting', '1-550m'],
      useCases: ['campfire-experience', 'outdoor-dining', 'lifestyle', 'couples-retreat']
    },

    // NEW VALLEY IMAGES - January 2026
    '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.40 AM (1).jpeg': {
      location: 'valley',
      subject: 'A-Frame Interior with Panoramic Windows',
      perspective: 'interior',
      content: 'Bright interior view of A-frame cabin showing light wood paneling walls and large expansive windows offering panoramic view of lush forest and distant mountains. Person lying on bed with floral duvet looking out window. Small white three-legged stools in foreground. Minimalist modern design.',
      seo: {
        alt: 'A-frame interior with panoramic mountain views at The Valley showing large windows and forest landscape at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Interior - Panoramic Mountain Views Through Large Windows',
        description: 'A bright interior view of an A-frame cabin at The Valley, featuring light wood paneling, large expansive windows offering breathtaking panoramic views of the lush forest and distant mountains, comfortable bed with floral duvet, and minimalist modern design at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'panoramic-windows', 'mountain-views', 'forest-views', 'modern', 'minimalist', 'bright', '1-550m'],
      useCases: ['a-frame-interior', 'mountain-views', 'modern-design', 'panoramic-windows', 'accommodation-showcase']
    },

    '/uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.40 AM.jpeg': {
      location: 'valley',
      subject: 'ATVs in Mountain Landscape',
      perspective: 'landscape',
      content: 'Outdoor landscape view showing two red all-terrain vehicles (ATVs) parked on grassy undulating hill. Vast expanse of mountains in background under partly cloudy sky with warm light suggesting sunrise or sunset. Mountain adventure scene.',
      seo: {
        alt: 'ATVs in mountain landscape at The Valley showing red vehicles and mountain views at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Mountain Adventure - ATV Experience at The Valley',
        description: 'An outdoor landscape view at The Valley showing two red all-terrain vehicles parked on a grassy hill, with a vast expanse of mountains in the background under a partly cloudy sky with warm lighting - showcasing the mountain adventure activities available at 1,550m altitude.'
      },
      tags: ['atv', 'adventure', 'landscape', 'mountain-views', 'outdoor-activity', 'vehicles', 'hillside', '1-550m'],
      useCases: ['adventure-activities', 'outdoor-experiences', 'mountain-adventure', 'activities']
    },

    '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.41 AM (1).jpeg': {
      location: 'valley',
      subject: 'A-Frame Kitchen and Wood Stove',
      perspective: 'interior',
      content: 'Interior view of compact kitchen and living area in A-frame. Person sitting on wooden stool next to lit black wood-burning stove holding mug. Small kitchenette with sink, black kettle, and dark grey cabinets above and below. Wooden sliding barn door partially visible.',
      seo: {
        alt: 'Compact kitchen and wood stove in A-frame cabin at The Valley showing modern amenities at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Kitchen - Compact Design with Wood-Burning Stove',
        description: 'An interior view of the compact kitchen and living area in an A-frame cabin at The Valley, featuring a lit wood-burning stove, small kitchenette with sink and kettle, dark grey cabinets, wooden barn door, and cozy seating at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'kitchen', 'wood-burning-stove', 'compact', 'kitchenette', 'modern-amenities', 'cozy', '1-550m'],
      useCases: ['a-frame-interior', 'kitchen-showcase', 'wood-stove', 'modern-amenities', 'compact-living']
    },

    '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.41 AM (2).jpeg': {
      location: 'valley',
      subject: 'A-Frame Interior with Mountain Views',
      perspective: 'interior',
      content: 'Interior view of cozy A-frame room with light wood walls. Person seated at small light-colored table next to large window holding mug. Snowy or forested mountain landscape visible through window. Black wood-burning stove with tall pipe in background.',
      seo: {
        alt: 'Cozy A-frame interior with mountain views through window at The Valley, 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Interior - Cozy Space with Mountain Views',
        description: 'A cozy interior view of an A-frame cabin at The Valley, featuring light wood walls, a small table next to a large window offering views of the snowy or forested mountain landscape, and a black wood-burning stove with tall pipe at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'mountain-views', 'window-views', 'cozy', 'wood-stove', 'light-wood', '1-550m'],
      useCases: ['a-frame-interior', 'mountain-views', 'cozy-atmosphere', 'window-views']
    },

    '/uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.41 AM (3).jpeg': {
      location: 'valley',
      subject: 'A-Frame Bathroom - Rustic Wooden Counter',
      perspective: 'interior',
      content: 'Interior view of rustic bathroom showing thick rough-hewn wooden countertop with round galvanized metal basin sink. Round mirror mounted on light wood wall above basin. Wall-mounted water heater visible. Small vase with pink flowers on counter. Rustic A-frame bathroom design.',
      seo: {
        alt: 'Rustic bathroom with wooden counter and metal basin in A-frame cabin at The Valley, 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Bathroom - Rustic Wooden Counter and Vintage Sink',
        description: 'A rustic bathroom interior in an A-frame cabin at The Valley, featuring a thick rough-hewn wooden countertop with a round galvanized metal basin sink, wooden-framed mirror, wall-mounted water heater, and decorative flowers - showcasing unique vintage-style bathroom design at 1,550m altitude.'
      },
      tags: ['a-frame', 'bathroom', 'interior', 'rustic', 'wooden-counter', 'metal-basin', 'vintage-style', '1-550m'],
      useCases: ['a-frame-interior', 'bathroom-showcase', 'rustic-design', 'vintage-style']
    },

    '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.41 AM (4).jpeg': {
      location: 'valley',
      subject: 'A-Frame Interior Evening Ambiance',
      perspective: 'interior',
      content: 'Interior view captured at dusk or night showing warm cozy ambiance. Person sitting on floor wrapped in blanket next to glowing wood-burning stove. String lights draped across ceiling. Several candles lit on small table casting soft light. Large windows revealing dark outdoor landscape.',
      seo: {
        alt: 'Cozy evening ambiance in A-frame cabin at The Valley showing wood stove, string lights, and candles at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Evening Ambiance - Cozy Night Atmosphere',
        description: 'A cozy evening interior view of an A-frame cabin at The Valley, captured at dusk or night, featuring a glowing wood-burning stove, string lights draped across the ceiling, lit candles on a small table, and large windows revealing the dark outdoor landscape - showcasing the warm evening atmosphere at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'evening', 'night', 'cozy', 'wood-stove', 'string-lights', 'candles', 'warm-ambiance', '1-550m'],
      useCases: ['a-frame-interior', 'evening-atmosphere', 'cozy-night', 'warm-ambiance']
    },

    '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.41 AM (5).jpeg': {
      location: 'valley',
      subject: 'A-Frame Interior with Panoramic Windows (Duplicate View)',
      perspective: 'interior',
      content: 'Bright interior view of A-frame cabin showing light wood paneling walls and large expansive windows offering panoramic view of lush forest and distant mountains. Person lying on bed with floral duvet looking out window. Similar to previous panoramic window view.',
      seo: {
        alt: 'A-frame interior with panoramic mountain views at The Valley showing large windows and forest landscape at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Interior - Panoramic Mountain Views Through Large Windows',
        description: 'A bright interior view of an A-frame cabin at The Valley, featuring light wood paneling, large expansive windows offering breathtaking panoramic views of the lush forest and distant mountains, comfortable bed with floral duvet, and minimalist modern design at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'panoramic-windows', 'mountain-views', 'forest-views', 'modern', 'minimalist', 'bright', '1-550m'],
      useCases: ['a-frame-interior', 'mountain-views', 'modern-design', 'panoramic-windows', 'accommodation-showcase']
    },

    '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.41 AM.jpeg': {
      location: 'valley',
      subject: 'A-Frame Kitchen with Person Reading',
      perspective: 'interior',
      content: 'Interior view of compact kitchen and living area in A-frame. Person sitting on wooden stool next to lit black wood-burning stove reading a book. Small kitchenette with sink, black kettle, and dark grey cabinets above and below. Cozy reading nook scene.',
      seo: {
        alt: 'Cozy kitchen nook with wood stove in A-frame cabin at The Valley, 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Kitchen Reading Nook - Cozy Wood Stove Area',
        description: 'An interior view of the compact kitchen and living area in an A-frame cabin at The Valley, featuring a lit wood-burning stove, a person reading a book on a wooden stool, small kitchenette with dark grey cabinets, creating a cozy reading nook at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'kitchen', 'wood-burning-stove', 'reading', 'cozy', 'nook', '1-550m'],
      useCases: ['a-frame-interior', 'cozy-atmosphere', 'reading-space', 'lifestyle']
    },

    '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.42 AM (1).jpeg': {
      location: 'valley',
      subject: 'A-Frame Interior with Sunset Window View',
      perspective: 'interior',
      content: 'Interior view of A-frame cabin showing person looking out window at sunset. Warm golden light streaming through window, light wood paneling, and panoramic window view of mountains and sky at golden hour.',
      seo: {
        alt: 'A-frame interior with sunset window view at The Valley showing person looking out at golden hour, 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Sunset Window View - A-Frame Interior at Golden Hour',
        description: 'An interior view of an A-frame cabin at The Valley showing a person looking out a panoramic window at sunset, with warm golden light streaming through, light wood paneling, and stunning views of mountains and sky at golden hour, 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'sunset', 'window-view', 'golden-hour', 'panoramic-window', 'mountain-views', 'sunset-light', '1-550m'],
      useCases: ['a-frame-interior', 'sunset-moment', 'window-view', 'golden-hour', 'sunrise-sunset']
    },

    '/uploads/The Valley/Lux-cabin-exterior-1768207498-98737209.jpg': {
      location: 'valley',
      subject: 'Person Reading in Nature',
      perspective: 'exterior',
      content: 'Exterior view showing person reading in natural outdoor setting at The Valley. Person seated outdoors with book, surrounded by nature, mountain views, and peaceful reading atmosphere.',
      seo: {
        alt: 'Person reading in nature at The Valley showing outdoor reading space and natural setting at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Reading in Nature - Quiet Outdoor Reading Space at The Valley',
        description: 'An exterior view at The Valley showing a person reading in a natural outdoor setting, seated peacefully with a book, surrounded by nature and mountain views, showcasing the perfect spot for quiet reading in nature at 1,550m altitude.'
      },
      tags: ['reading', 'person', 'outdoor', 'nature', 'lifestyle', 'reading-in-nature', 'peaceful', 'natural-setting', '1-550m'],
      useCases: ['reading-moment', 'lifestyle', 'outdoor-reading', 'nature-experience', 'quiet-moments']
    },

    '/uploads/The Valley/1768207815-2996ea84.jpg': {
      location: 'valley',
      subject: 'The Valley Mountain Village Overview - Summer',
      perspective: 'landscape',
      content: 'Panoramic landscape view of The Valley mountain village at 1,550m altitude showing A-frame cabins, Stone House, and shared outdoor spaces in summer. Mountain village where each stay is private but the land is shared.',
      seo: {
        alt: 'Panoramic summer view of The Valley mountain village at 1,550m altitude showing A-frame cabins, Stone House, and shared spaces, Rhodope Mountains, Bulgaria',
        title: 'The Valley - Mountain Village at 1,550m Altitude (Summer)',
        description: 'A panoramic summer landscape view of The Valley mountain village at 1,550m altitude, showcasing A-frame cabins, the historic Stone House, and shared outdoor spaces - a village where each stay is private but the land is shared, located in the Rhodope Mountains, Bulgaria.'
      },
      tags: ['valley-overview', 'panoramic', 'landscape', 'a-frames', 'stone-house', 'mountain-village', '1-550m', 'shared-spaces', 'private-stays', 'summer'],
      useCases: ['valley-hero', 'vibe-section-lead', 'village-overview', 'landscape-showcase', 'seasonal-comparison']
    },

    '/uploads/The Valley/1768208001-196d2a1f.jpg': {
      location: 'valley',
      subject: 'The Valley Mountain Village Overview - Winter',
      perspective: 'landscape',
      content: 'Panoramic landscape view of The Valley mountain village at 1,550m altitude showing A-frame cabins, Stone House, and shared outdoor spaces in winter. Snow-covered landscape, winter atmosphere, mountain village where each stay is private but the land is shared.',
      seo: {
        alt: 'Panoramic winter view of The Valley mountain village at 1,550m altitude showing snow-covered A-frame cabins, Stone House, and shared spaces, Rhodope Mountains, Bulgaria',
        title: 'The Valley - Mountain Village at 1,550m Altitude (Winter)',
        description: 'A panoramic winter landscape view of The Valley mountain village at 1,550m altitude, showcasing snow-covered A-frame cabins, the historic Stone House, and shared outdoor spaces in winter - a village where each stay is private but the land is shared, located in the Rhodope Mountains, Bulgaria.'
      },
      tags: ['valley-overview', 'panoramic', 'landscape', 'a-frames', 'stone-house', 'mountain-village', '1-550m', 'shared-spaces', 'private-stays', 'winter', 'snow'],
      useCases: ['valley-hero', 'vibe-section-lead', 'village-overview', 'landscape-showcase', 'seasonal-comparison']
    },

    '/uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.42 AM.jpeg': {
      location: 'valley',
      subject: 'A-Frame Interior with Table and Views',
      perspective: 'interior',
      content: 'Interior view of A-frame cabin showing light wood walls, small table, and window with views. Cozy interior space with natural lighting.',
      seo: {
        alt: 'Cozy A-frame interior with table and window views at The Valley, 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Interior - Cozy Space with Natural Light',
        description: 'A cozy interior view of an A-frame cabin at The Valley, featuring light wood walls, a small table, and windows offering natural views, with natural lighting creating a warm atmosphere at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'cozy', 'table', 'window-views', 'natural-light', '1-550m'],
      useCases: ['a-frame-interior', 'cozy-atmosphere', 'natural-light']
    },

    '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.46 AM.jpeg': {
      location: 'valley',
      subject: 'A-Frame Interior View',
      perspective: 'interior',
      content: 'Interior view of A-frame cabin showing cozy space with light wood paneling and comfortable furnishings. General interior view.',
      seo: {
        alt: 'Cozy A-frame interior at The Valley showing light wood design at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Interior - Cozy Mountain Retreat',
        description: 'A cozy interior view of an A-frame cabin at The Valley, showcasing the light wood paneling and comfortable furnishings in a warm mountain retreat setting at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'cozy', 'wood-paneling', 'comfortable', '1-550m'],
      useCases: ['a-frame-interior', 'cozy-atmosphere', 'accommodation-showcase']
    },

    '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.47 AM.jpeg': {
      location: 'valley',
      subject: 'A-Frame Interior Wide View',
      perspective: 'interior',
      content: 'Wide interior view of A-frame cabin showing spacious layout with light wood walls, furnishings, and large windows. Comprehensive view of cabin interior space.',
      seo: {
        alt: 'Spacious A-frame interior at The Valley showing wide layout and large windows at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Interior - Spacious Layout with Large Windows',
        description: 'A wide interior view of an A-frame cabin at The Valley, showcasing the spacious layout with light wood walls, comfortable furnishings, and large windows at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'spacious', 'wide-view', 'large-windows', 'layout', '1-550m'],
      useCases: ['a-frame-interior', 'spacious-layout', 'accommodation-showcase']
    },

    '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.51 AM.jpeg': {
      location: 'valley',
      subject: 'A-Frame Interior with Natural Elements',
      perspective: 'interior',
      content: 'Interior view of A-frame cabin showing light wood construction, natural materials, and cozy atmosphere. Interior space with natural design elements.',
      seo: {
        alt: 'A-frame interior with natural design elements at The Valley, 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Interior - Natural Design Elements',
        description: 'An interior view of an A-frame cabin at The Valley, featuring light wood construction, natural materials, and a cozy atmosphere showcasing natural design elements at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'natural-elements', 'wood-construction', 'cozy', 'design', '1-550m'],
      useCases: ['a-frame-interior', 'natural-design', 'cozy-atmosphere']
    },

    '/uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.52 AM (1).jpeg': {
      location: 'valley',
      subject: 'A-Frame Interior Detail View',
      perspective: 'interior',
      content: 'Detail interior view of A-frame cabin showing architectural elements and design details. Close-up view of cabin features.',
      seo: {
        alt: 'A-frame interior detail at The Valley showing architectural elements at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Interior Detail - Architectural Elements',
        description: 'A detail interior view of an A-frame cabin at The Valley, showcasing architectural elements and design details at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'detail', 'architecture', 'design-elements', '1-550m'],
      useCases: ['a-frame-interior', 'architecture-detail', 'design-highlight']
    },

    '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.52 AM.jpeg': {
      location: 'valley',
      subject: 'A-Frame Interior with Cozy Atmosphere',
      perspective: 'interior',
      content: 'Interior view of A-frame cabin showing cozy atmosphere with light wood, comfortable space, and warm ambiance. General cozy interior view.',
      seo: {
        alt: 'Cozy A-frame interior at The Valley showing warm atmosphere at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Interior - Cozy Warm Atmosphere',
        description: 'A cozy interior view of an A-frame cabin at The Valley, featuring light wood construction, comfortable space, and warm ambiance creating a welcoming mountain retreat atmosphere at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'cozy', 'warm-atmosphere', 'comfortable', '1-550m'],
      useCases: ['a-frame-interior', 'cozy-atmosphere', 'warm-ambiance']
    },

    '/uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.53 AM.jpeg': {
      location: 'valley',
      subject: 'A-Frame Interior Panoramic View',
      perspective: 'interior',
      content: 'Wide panoramic interior view of A-frame cabin showing expansive space, light wood paneling, large windows, and comfortable furnishings. Comprehensive interior overview.',
      seo: {
        alt: 'Panoramic A-frame interior at The Valley showing expansive space and large windows at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'A-Frame Interior - Panoramic Expansive View',
        description: 'A wide panoramic interior view of an A-frame cabin at The Valley, showcasing the expansive space, light wood paneling, large windows, and comfortable furnishings in a comprehensive interior overview at 1,550m altitude.'
      },
      tags: ['a-frame', 'interior', 'panoramic', 'expansive', 'large-windows', 'spacious', '1-550m'],
      useCases: ['a-frame-interior', 'panoramic-view', 'spacious-layout', 'accommodation-showcase']
    },

    // Content Website Valley Images
    '/uploads/Content%20website/SKy-view-Aframe.jpg': {
      location: 'valley',
      subject: 'Aerial View of A-Frames',
      perspective: 'aerial',
      content: 'Drone or aerial view from above showing multiple A-frame cabins, layout of The Valley village, paths, and surrounding landscape',
      seo: {
        alt: 'Aerial drone view of The Valley showing multiple A-frame cabins, village layout, paths, and mountain landscape at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Aerial View of The Valley - A-Frame Village Layout from Above',
        description: 'A stunning aerial view of The Valley showing the collection of 13 geometric A-frame cabins, the walkable village layout, connecting paths, and the dramatic mountain landscape at 1,550m altitude - the highest inhabited village in the Balkans.'
      },
      tags: ['aerial', 'drone-view', 'a-frames', 'village-layout', 'overview', 'geometric', 'paths', '1-550m'],
      useCases: ['valley-map', 'village-overview', 'interactive-map', 'hero-background', 'layout-explanation']
    },

    '/uploads/Content%20website/drift-dwells-bulgaria-starlit-mountain.avif': {
      location: 'valley',
      subject: 'Night Landscape',
      perspective: 'landscape',
      content: 'Night landscape showing starry sky, mountains, and The Valley area under stars',
      seo: {
        alt: 'Starry night sky over The Valley showing mountains, starry sky, and night landscape at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Starry Night at The Valley - Mountain Nightscape Under Stars',
        description: 'A breathtaking night landscape at The Valley showing the star-filled sky, silhouetted mountains, and the peaceful night atmosphere at 1,550m altitude - perfect for stargazing in the clear mountain air of the Rhodope Mountains.'
      },
      tags: ['night', 'stars', 'nightscape', 'sky', 'mountains', 'stargazing', 'atmosphere', 'dark-sky'],
      useCases: ['night-atmosphere', 'star-gazing', 'landscape-hero', 'mood-content']
    },

    '/uploads/Content%20website/drift-dwells-bulgaria-fireside-lounge.avif': {
      location: 'valley',
      subject: 'Communal Fireplace / Stone House Interior',
      perspective: 'interior',
      content: 'Interior view of communal fireside lounge area, likely in Stone House, showing fireplace, seating, and cozy gathering space',
      seo: {
        alt: 'Communal fireside lounge interior at The Valley Stone House showing fireplace, comfortable seating, and cozy gathering space for guests, Rhodope Mountains',
        title: 'Communal Fireside Lounge - Stone House Gathering Space',
        description: 'The welcoming communal fireside lounge area in the Stone House at The Valley, featuring a warm fireplace, comfortable seating arrangements, and the cozy atmosphere perfect for gathering with other guests or relaxing after a day of mountain activities.'
      },
      tags: ['interior', 'stone-house', 'communal', 'fireplace', 'lounge', 'gathering-space', 'seating', 'cozy'],
      useCases: ['stone-house-interior', 'communal-spaces', 'gathering-area', 'lifestyle']
    },

    '/uploads/Content%20website/drift-dwells-bulgaria-river-letters.avif': {
      location: 'valley',
      subject: 'River/Nature Scene',
      perspective: 'landscape',
      content: 'Natural river or stream scene in The Valley area, possibly with creative elements like floating letters or notes',
      seo: {
        alt: 'River scene in The Valley showing natural stream, rocks, and mountain landscape at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Mountain River Scene at The Valley - Natural Stream in Rhodope Mountains',
        description: 'A beautiful natural river or stream scene in The Valley area, showcasing the pristine mountain water, rocky banks, and the untouched natural beauty of the Rhodope Mountains at 1,550m altitude.'
      },
      tags: ['river', 'stream', 'nature', 'water', 'landscape', 'natural', 'rocks', 'mountain-water'],
      useCases: ['nature-scenery', 'water-features', 'landscape-gallery', 'natural-beauty']
    },

    // MISCLASSIFIED - Actually Cabin images (for reference, do not use for Valley)
    '/uploads/Content%20website/drift-dwells-bulgaria-valley-haven.avif': {
      location: 'cabin', // ⚠️ MISCLASSIFIED - Actually Cabin!
      subject: 'The Cabin (Bachevo) Interior',
      perspective: 'interior',
      content: 'Interior view of Bucephalus cabin showing main living space, wooden interior, and cozy atmosphere',
      seo: {
        alt: 'Interior of Bucephalus off-grid cabin showing rustic wooden walls and cozy living space, Rhodope Mountains, Bulgaria',
        title: 'Cabin Interior - Bucephalus Living Space',
        description: 'The cozy interior of the Bucephalus cabin near Bachevo, showcasing rustic wooden construction and the comfortable off-grid living space.'
      },
      tags: ['interior', 'cabin', 'bucephalus', 'wooden', 'rustic', 'living-space'],
      note: '❌ DO NOT USE FOR VALLEY - This is actually a Cabin (Bachevo) image, not Valley!',
      useCases: ['cabin-interior', 'bucephalus-showcase']
    },

    '/uploads/Content%20website/drift-dwells-bulgaria-campfire-night.avif': {
      location: 'cabin', // ⚠️ MISCLASSIFIED - Actually Cabin!
      subject: 'The Cabin (Bachevo) Front Porch',
      perspective: 'exterior',
      content: 'Front porch area of Bucephalus cabin showing two seats, outdoor space, and forest setting',
      seo: {
        alt: 'Front porch of Bucephalus cabin with two seats and forest view, showing outdoor relaxation area, Rhodope Mountains',
        title: 'Cabin Front Porch - Outdoor Seating at Bucephalus',
        description: 'The welcoming front porch of the Bucephalus cabin, featuring two comfortable seats and offering a peaceful outdoor space to relax while surrounded by the forest of the Rhodope Mountains.'
      },
      tags: ['exterior', 'porch', 'front-porch', 'seating', 'outdoor', 'cabin', 'bucephalus'],
      note: '❌ DO NOT USE FOR VALLEY - This is actually a Cabin (Bachevo) image showing front porch with 2 seats!',
      useCases: ['cabin-exterior', 'porch-area', 'outdoor-space']
    }
  },

  // ============================================
  // VIDEO POSTERS
  // ============================================
  videos: {
    '/uploads/Videos/The-cabin-header.winter-poster.jpg': {
      location: 'cabin',
      subject: 'The Cabin (Bucephalus) Hero/Header',
      perspective: 'exterior',
      content: 'Hero image showing Bucephalus cabin exterior in forest setting, used as video poster and header image',
      seo: {
        alt: 'The Cabin (Bucephalus) - Off-grid mountain cabin exterior showing rustic wooden structure in forest setting near Bachevo, Rhodope Mountains, Bulgaria',
        title: 'The Cabin - Off-Grid Mountain Retreat in Rhodope Mountains',
        description: 'Hero image of The Cabin (formerly Bucephalus), an off-grid mountain retreat nestled in the forest near Bachevo in the Rhodope Mountains, showcasing rustic wooden architecture and natural setting.'
      },
      tags: ['cabin', 'bucephalus', 'hero', 'header', 'video-poster', 'exterior', 'forest'],
      useCases: ['hero-image', 'video-poster', 'header', 'cabin-showcase']
    },

    '/uploads/Videos/The-Valley-firaplace-video-poster.jpg': {
      location: 'valley',
      subject: 'The Valley Hero/Header',
      perspective: 'landscape',
      content: 'Hero image showing The Valley mountain village with fireplace, A-frames, stone house, and mountain landscape at 1,550m altitude, used as video poster',
      seo: {
        alt: 'The Valley: A Village Above the Clouds - Mountain village at 1,550m altitude showing A-frames, stone house, fireplace, and mountain landscape, Chereshovo/Ortsevo, Rhodope Mountains, Bulgaria',
        title: 'The Valley - A Village Above the Clouds at 1,550m Altitude',
        description: 'Hero image of The Valley, a mountain village at 1,550m altitude (the highest inhabited village in the Balkans) near Chereshovo and Ortsevo, showcasing the collection of A-frames, historic stone house, communal spaces, and stunning mountain landscape.'
      },
      tags: ['valley', 'hero', 'header', 'video-poster', 'village', 'a-frames', 'stone-house', '1-550m', 'mountain-landscape'],
      useCases: ['hero-image', 'video-poster', 'header', 'valley-showcase']
    }
  },

  // ============================================
  // GENERIC / SHARED Images
  // ============================================
  generic: {
    '/uploads/Content%20website/drift-dwells-bulgaria-firepit-sketch.png': {
      location: 'generic',
      subject: 'Illustration',
      perspective: 'illustration',
      content: 'Hand-drawn or artistic sketch illustration of firepit, decorative element',
      seo: {
        alt: 'Hand-drawn sketch illustration of firepit, decorative artwork for Drift & Dwells brand',
        title: 'Firepit Illustration - Decorative Artwork',
        description: 'A hand-drawn artistic illustration of a firepit, used as a decorative design element for the Drift & Dwells brand.'
      },
      tags: ['illustration', 'sketch', 'artwork', 'decorative', 'firepit', 'design-element'],
      useCases: ['decoration', 'brand-assets', 'illustration', 'design']
    },

    '/uploads/Content%20website/drift-dwells-bulgaria-lantern-walk.png': {
      location: 'generic',
      subject: 'Illustration / Atmosphere',
      perspective: 'illustration',
      content: 'Artistic illustration or atmosphere image showing lantern-lit walk or path',
      seo: {
        alt: 'Artistic illustration of lantern-lit walk through forest, atmospheric artwork',
        title: 'Lantern Walk Illustration - Atmospheric Artwork',
        description: 'An atmospheric artistic illustration depicting a lantern-lit walk through the forest, evoking the magical evening atmosphere of mountain retreats.'
      },
      tags: ['illustration', 'lantern', 'walk', 'atmosphere', 'artwork', 'evening', 'mood'],
      useCases: ['atmosphere', 'illustration', 'mood-content', 'artistic']
    },

    '/uploads/Content%20website/drift-dwells-bulgaria-pine-sketch.png': {
      location: 'generic',
      subject: 'Illustration',
      perspective: 'illustration',
      content: 'Hand-drawn sketch illustration of pine trees, decorative botanical art',
      seo: {
        alt: 'Hand-drawn sketch illustration of pine trees, decorative botanical artwork',
        title: 'Pine Tree Illustration - Botanical Artwork',
        description: 'A delicate hand-drawn sketch illustration of pine trees, used as decorative botanical artwork for the Drift & Dwells brand.'
      },
      tags: ['illustration', 'sketch', 'pine-trees', 'botanical', 'artwork', 'decorative'],
      useCases: ['decoration', 'botanical-art', 'illustration', 'design-element']
    },

    '/uploads/Content%20website/drift-dwells-bulgaria-vintage-map.png': {
      location: 'generic',
      subject: 'Illustration',
      perspective: 'illustration',
      content: 'Vintage-style map illustration, decorative design element',
      seo: {
        alt: 'Vintage-style map illustration showing mountain region, decorative artwork',
        title: 'Vintage Map Illustration - Decorative Design Element',
        description: 'A vintage-style map illustration showcasing the mountain region, used as a decorative design element that evokes the sense of exploration and adventure.'
      },
      tags: ['illustration', 'map', 'vintage', 'decorative', 'artwork', 'design'],
      useCases: ['decoration', 'map-design', 'illustration', 'brand-asset']
    },

    // LUXURY CABIN IMAGES - January 2026 (Renamed with Lux-cabin- prefix)
    // Exterior: Lux-cabin-exterior- prefix where present on disk
    // Interior: Lux-cabin- prefix for 2026-01-11; WhatsApp... for 2025-10-17 and 4.36.14

    '/uploads/The Valley/WhatsApp Image 2025-12-03 at 4.36.14 PM.jpeg': {
      location: 'valley',
      subject: 'Luxury Cabin Interior - Modern Plywood Design',
      perspective: 'interior',
      content: 'Interior view of Luxury Cabin showing modern interior with plywood walls, large windows, and contemporary design. Dark/black square building with spacious, comfortable living space. Full comfort with heating and modern amenities.',
      seo: {
        alt: 'Luxury cabin interior at The Valley showing modern plywood walls and large windows at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Luxury Cabin Interior - Modern Plywood Design with Large Windows',
        description: 'The modern interior of the Luxury Cabin at The Valley, featuring plywood walls, large windows offering panoramic mountain views, contemporary design, and full comfort with heating and modern amenities at 1,550m altitude - perfect for couples seeking a private, comfortable mountain retreat.'
      },
      tags: ['luxury-cabin', 'interior', 'modern', 'plywood-walls', 'large-windows', 'contemporary', 'comfortable', 'heating', 'amenities', '1-550m'],
      useCases: ['luxury-cabin-interior', 'accommodation-showcase', 'modern-interior', 'comfort-features', 'interior-gallery']
    },

    // New Luxury Cabin Exterior Images - January 2026 (Watermark Removed)
    '/uploads/The Valley/Lux-cabin-exterior-watermark-remover-20260113071503.jpg': {
      location: 'valley',
      subject: 'Luxury Cabin Exterior - Modern Dark Square Building',
      perspective: 'exterior',
      content: 'Exterior view of Luxury Cabin showing dark/black square building with large windows. Modern architectural design, secluded vantage point at The Valley. Perfect for couples seeking privacy and comfort.',
      seo: {
        alt: 'Luxury cabin exterior at The Valley showing dark square building with large windows at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Luxury Cabin - Modern Dark Square Building with Large Windows',
        description: 'The exterior of the Luxury Cabin at The Valley, featuring a distinctive dark/black square building with large windows, modern architectural design, and a secluded vantage point perfect for couples seeking privacy and comfort at 1,550m altitude.'
      },
      tags: ['luxury-cabin', 'exterior', 'dark-building', 'square', 'large-windows', 'modern', 'couples-retreat', 'secluded', '1-550m'],
      useCases: ['luxury-cabin-exterior', 'accommodation-showcase', 'couples-retreat', 'modern-design', 'booking-card']
    },

    '/uploads/The Valley/Lux-cabin-exterior-watermark-remover-20260113071503(1).jpg': {
      location: 'valley',
      subject: 'Luxury Cabin Exterior - Mountain Setting',
      perspective: 'exterior',
      content: 'Exterior view of Luxury Cabin showing dark/black square building with large windows, set against mountain landscape. Modern architectural design, secluded location at The Valley.',
      seo: {
        alt: 'Luxury cabin exterior at The Valley showing dark square building in mountain setting at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Luxury Cabin Exterior - Modern Building in Mountain Setting',
        description: 'The exterior of the Luxury Cabin at The Valley, featuring a dark/black square building with large windows, modern architectural design, set against the beautiful mountain landscape at 1,550m altitude - perfect for couples seeking privacy and comfort.'
      },
      tags: ['luxury-cabin', 'exterior', 'dark-building', 'square', 'large-windows', 'modern', 'mountain-setting', 'secluded', '1-550m'],
      useCases: ['luxury-cabin-exterior', 'accommodation-showcase', 'mountain-setting', 'exterior-gallery']
    },

    '/uploads/The Valley/Lux-cabin-exterior-watermark-remover-20260113071503(2).jpg': {
      location: 'valley',
      subject: 'Luxury Cabin Exterior - Architectural Detail',
      perspective: 'exterior',
      content: 'Exterior view of Luxury Cabin showing dark/black square building with large windows, architectural details, and modern design. Secluded vantage point at The Valley.',
      seo: {
        alt: 'Luxury cabin exterior at The Valley showing architectural details and modern design at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Luxury Cabin Exterior - Modern Architectural Design Details',
        description: 'An exterior view of the Luxury Cabin at The Valley, showcasing the dark/black square building with large windows, architectural details, and modern design at a secluded vantage point at 1,550m altitude.'
      },
      tags: ['luxury-cabin', 'exterior', 'dark-building', 'square', 'large-windows', 'modern', 'architectural-details', 'secluded', '1-550m'],
      useCases: ['luxury-cabin-exterior', 'accommodation-showcase', 'architectural-details', 'exterior-gallery']
    },

    '/uploads/The Valley/Lux-cabin-exterior-watermark-remover-20260113071503(3).jpg': {
      location: 'valley',
      subject: 'Luxury Cabin Exterior - Panoramic View',
      perspective: 'exterior',
      content: 'Exterior view of Luxury Cabin showing dark/black square building with large windows, panoramic mountain backdrop. Modern architectural design, secluded location at The Valley.',
      seo: {
        alt: 'Luxury cabin exterior at The Valley showing dark building with panoramic mountain backdrop at 1,550m altitude, Rhodope Mountains, Bulgaria',
        title: 'Luxury Cabin Exterior - Panoramic Mountain Backdrop',
        description: 'An exterior view of the Luxury Cabin at The Valley, featuring the dark/black square building with large windows, modern architectural design, and a stunning panoramic mountain backdrop at 1,550m altitude - perfect for couples seeking privacy and breathtaking views.'
      },
      tags: ['luxury-cabin', 'exterior', 'dark-building', 'square', 'large-windows', 'modern', 'panoramic-views', 'mountain-backdrop', 'secluded', '1-550m'],
      useCases: ['luxury-cabin-exterior', 'accommodation-showcase', 'panoramic-views', 'exterior-gallery', 'mountain-views']
    }
  }
};

/**
 * Get image metadata by path
 * @param {string} imagePath - The image path to look up
 * @returns {object|null} - Image metadata or null if not found
 */
export function getImageMetadata(imagePath) {
  // Normalize path
  const normalized = imagePath.replace(/\\/g, '/');
  
  // Check direct matches first
  if (imageMetadata.cabin[normalized]) return { ...imageMetadata.cabin[normalized], source: 'cabin' };
  if (imageMetadata.valley[normalized]) return { ...imageMetadata.valley[normalized], source: 'valley' };
  if (imageMetadata.generic[normalized]) return { ...imageMetadata.generic[normalized], source: 'generic' };
  
  // Check if it's from The Cabin folder
  if (normalized.includes('/The Cabin/') || normalized.includes('/cabins/')) {
    return {
      location: 'cabin',
      subject: 'The Cabin (Bucephalus)',
      perspective: 'unknown',
      content: 'Image from Bucephalus cabin collection - verify specific content',
      seo: {
        alt: 'Bucephalus off-grid cabin image, Rhodope Mountains, Bulgaria',
        title: 'Bucephalus Cabin Image',
        description: 'An image from the Bucephalus off-grid mountain cabin near Bachevo in the Rhodope Mountains.'
      },
      tags: ['cabin', 'bucephalus', 'bachevo'],
      note: '⚠️ Needs specific metadata - add to database for precise categorization'
    };
  }
  
  // Check if it's from The Valley folder
  if (normalized.includes('/The Valley/')) {
    return {
      location: 'valley',
      subject: 'The Valley',
      perspective: 'unknown',
      content: 'Image from The Valley collection - verify specific content',
      seo: {
        alt: 'The Valley mountain village image, 1,550m altitude, Chereshovo/Ortsevo, Rhodope Mountains, Bulgaria',
        title: 'The Valley Image',
        description: 'An image from The Valley mountain village at 1,550m altitude near Chereshovo and Ortsevo in the Rhodope Mountains.'
      },
      tags: ['valley', '1-550m', 'mountain-village'],
      note: '⚠️ Needs specific metadata - add to database for precise categorization'
    };
  }
  
  // Check video posters
  if (imageMetadata.videos && imageMetadata.videos[normalized]) {
    return { ...imageMetadata.videos[normalized], source: 'videos' };
  }
  
  return null;
}

/**
 * Find images by criteria
 * @param {object} criteria - Search criteria
 * @param {string} criteria.location - 'cabin', 'valley', or 'generic'
 * @param {string} criteria.subject - Specific subject (e.g., 'Stone House', 'A-Frame')
 * @param {string} criteria.perspective - 'interior', 'exterior', 'landscape', etc.
 * @param {string[]} criteria.tags - Array of tags to match
 * @returns {Array} - Array of matching image paths with metadata
 */
export function findImagesByCriteria(criteria = {}) {
  const results = [];
  const { location, subject, perspective, tags = [] } = criteria;
  
  // Search through all locations
  const locations = ['cabin', 'valley', 'generic', 'videos'];
  
  locations.forEach(loc => {
    if (location && loc !== location) return;
    
    const images = imageMetadata[loc];
    Object.entries(images).forEach(([path, metadata]) => {
      // Skip folder entries
      if (path.endsWith('/')) return;
      
      let matches = true;
      
      if (subject && metadata.subject && !metadata.subject.toLowerCase().includes(subject.toLowerCase())) {
        matches = false;
      }
      
      if (perspective && metadata.perspective !== perspective) {
        matches = false;
      }
      
      if (tags.length > 0) {
        const imageTags = metadata.tags || [];
        const hasAnyTag = tags.some(tag => 
          imageTags.some(imgTag => imgTag.toLowerCase().includes(tag.toLowerCase()))
        );
        if (!hasAnyTag) matches = false;
      }
      
      if (matches) {
        results.push({
          path,
          ...metadata,
          source: loc
        });
      }
    });
  });
  
  return results;
}

/**
 * Get SEO-optimized alt text for an image
 * @param {string} imagePath - The image path
 * @returns {string} - SEO-optimized alt text
 */
export function getSEOAlt(imagePath) {
  const metadata = getImageMetadata(imagePath);
  return metadata?.seo?.alt || 'Drift & Dwells mountain retreat image, Rhodope Mountains, Bulgaria';
}

/**
 * Get SEO-optimized title for an image
 * @param {string} imagePath - The image path
 * @returns {string} - SEO-optimized title
 */
export function getSEOTitle(imagePath) {
  const metadata = getImageMetadata(imagePath);
  return metadata?.seo?.title || 'Drift & Dwells Mountain Retreat';
}
