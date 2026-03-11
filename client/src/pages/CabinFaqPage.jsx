import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Minus } from 'lucide-react';
import Seo from '../components/Seo';

const faqTextAnswers = {
  'What time is check-in and check-out?': 'Check-in is from 3:00 PM onwards. Check-out is by 11:00 AM. Early check-in or late check-out may be possible but must be arranged in advance.',
  'How do I receive access instructions?': 'Detailed access instructions, GPS coordinates, and directions are sent via email after booking confirmation. Save or print them as you may lose phone signal approaching the cabin.',
  'What type of vehicle do I need?': 'High clearance vehicles are strongly recommended. 4x4 vehicles are ideal. City cars and low clearance vehicles cannot reliably reach the cabin. In winter, snow chains or 4x4 may be essential.',
  'What power is available?': 'There are no standard power outlets. A small solar system provides power for basic LED lighting only and cannot support appliances, chargers, or high-consumption devices.',
  'How do I charge my phone and devices?': 'You must bring your own fully charged power banks or battery packs. There is no way to recharge them at the cabin.',
  'Where does drinking water come from?': 'Drinking water comes from a natural spring source near the cabin. The water is clean and safe to drink.',
  'How long does it take to heat the hot tub?': 'The wood-fired hot tub takes 4-6 hours to heat from cold. This requires maintaining a fire for the entire duration. In winter, heating takes significantly longer and may be impractical.',
  'How does the composting toilet work?': 'The cabin uses a composting toilet system that does not require water or flushing. Add sawdust or provided material after each use as directed.',
  'What is the main heating source?': 'The main heat source is a wood stove located in the cabin. You must light and maintain the fire yourself. There is no automatic heating system. Firewood is provided.',
  'Can I bring my pet?': 'No. Pets are not permitted at The Cabin. The remote location and presence of wildlife make it unsuitable for pets.',
  'Is there wifi?': 'No. There is no wifi connection at the cabin. This is a full digital detox location.',
  'Is there phone signal?': 'Mobile reception is weak or completely absent at the cabin. Do not rely on having phone signal during your stay.',
  'Should I bring my own food?': 'Yes. You must bring all food and drinks for your stay. There are no nearby shops or restaurants.',
  'What wildlife might I encounter?': 'The area is home to various wildlife including bears, wolves, wild boar, and smaller animals. Store food securely and never feed wildlife.',
  'Where exactly is The Cabin located?': 'The Cabin is located near Bachevo in the Rhodope Mountains, Bulgaria. Exact GPS coordinates are provided after booking confirmation.'
};

const CabinFaqPage = () => {
  const [openCategory, setOpenCategory] = useState(null);
  const [openQuestion, setOpenQuestion] = useState({});

  const toggleCategory = (categoryIndex) => {
    setOpenCategory(openCategory === categoryIndex ? null : categoryIndex);
  };

  const toggleQuestion = (categoryIndex, questionIndex) => {
    const key = `${categoryIndex}-${questionIndex}`;
    setOpenQuestion(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const faqJsonLd = useMemo(() => ({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: Object.entries(faqTextAnswers).map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a }
    }))
  }), []);

  const faqData = [
    {
      category: 'Arrival & Check-in',
      questions: [
        {
          question: 'What time is check-in and check-out?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Check-in is from 3:00 PM onwards.</li>
              <li>Check-out is by 11:00 AM.</li>
              <li>Early check-in or late check-out may be possible but must be arranged in advance.</li>
              <li>Allow extra time for the drive to the cabin, especially in winter or after rain.</li>
            </ul>
          )
        },
        {
          question: 'How do I receive access instructions?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Detailed access instructions, GPS coordinates, and directions are sent via email after booking confirmation.</li>
              <li>Review these instructions carefully before your arrival.</li>
              <li>Save or print the directions as you may lose phone signal approaching the cabin.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Access, Roads & Parking',
      questions: [
        {
          question: 'What type of vehicle do I need?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>High clearance vehicles are strongly recommended. Normal cars can reach the cabin but must drive very slowly over rough terrain.</li>
              <li>4x4 vehicles are ideal but not always necessary in good conditions.</li>
              <li>City cars, low clearance vehicles, and taxis cannot reliably reach the cabin.</li>
              <li>In winter, snow chains or 4x4 may be essential.</li>
            </ul>
          )
        },
        {
          question: 'How long does the drive take from the main road?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>The forest road from the main road to the cabin typically takes 15-20 minutes in good conditions.</li>
              <li>In winter or after heavy rain, allow 25-35 minutes for the same distance.</li>
              <li>Drive slowly and watch for potholes, stones, and uneven terrain.</li>
            </ul>
          )
        },
        {
          question: 'What are road conditions like in different seasons?',
          answer: (
            <>
              <p className="mb-3">Road conditions vary significantly by season:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Winter (November-March): Snow and ice make the road challenging. Chains may be required. Drive with extreme caution.</li>
                <li>Spring (March-May): Mud after rain makes the road slippery and slow. Expect to move carefully.</li>
                <li>Summer (June-September): Dry conditions are easiest, but dust can be heavy and the road remains rough with stones and potholes.</li>
                <li>Autumn (October-November): Similar to spring with mud risks after rain.</li>
              </ul>
            </>
          )
        },
        {
          question: 'Where do I park?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Parking is available near the cabin. Space is limited, so inform us if you have multiple vehicles.</li>
              <li>Park in the designated area to avoid blocking access routes.</li>
              <li>In winter, ensure you park where you can exit easily if snow accumulates.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Power & Electricity',
      questions: [
        {
          question: 'What power is available?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>There are no standard power outlets in the cabin.</li>
              <li>A small solar system provides power for basic LED lighting only.</li>
              <li>The solar system cannot support any appliances, chargers, or high-consumption devices.</li>
            </ul>
          )
        },
        {
          question: 'How do I charge my phone and devices?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>You must bring your own fully charged power banks or battery packs.</li>
              <li>Charge all devices before arriving at the cabin.</li>
              <li>Use power banks sparingly as there is no way to recharge them at the cabin.</li>
              <li>Consider bringing multiple power banks if you need extended device use.</li>
            </ul>
          )
        },
        {
          question: 'What devices cannot be used?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Electric kettles, hair dryers, heaters, or any heating appliances.</li>
              <li>Laptops, tablets, or any high-consumption electronics.</li>
              <li>AC adapters for charging devices directly from outlets (there are no outlets).</li>
              <li>Any device that requires more power than basic LED lighting.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Water, Bathing & Hot Water',
      questions: [
        {
          question: 'Where does drinking water come from?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Drinking water comes from a natural spring source near the cabin.</li>
              <li>You collect water using containers or taps provided at the cabin.</li>
              <li>The water is clean and safe to drink, but you may prefer to bring bottled water if you have concerns.</li>
            </ul>
          )
        },
        {
          question: 'How do I get hot water for washing?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Hot water is prepared manually using a basin system heated on the wood stove.</li>
              <li>You heat water in containers on the stove, then transfer to wash basins as needed.</li>
              <li>This is a hands-on process that requires planning and effort.</li>
              <li>Allow time for water to heat on the stove before you need it.</li>
            </ul>
          )
        },
        {
          question: 'Are there winter limitations for water?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Yes. In winter, water freezes more easily and the system works slower.</li>
              <li>Allow extra time for water preparation and collection.</li>
              <li>Containers may freeze if left outside overnight.</li>
              <li>You may need to break ice or wait for water to thaw in very cold conditions.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Hot Tub',
      questions: [
        {
          question: 'How long does it take to heat the hot tub?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>The wood-fired hot tub takes 4-6 hours to heat from cold to usable temperature.</li>
              <li>This requires maintaining a fire in the hot tub heater for the entire duration.</li>
              <li>Timing depends on outside temperature, wind, and how consistently you maintain the fire.</li>
            </ul>
          )
        },
        {
          question: 'How much firewood does it use?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>The hot tub consumes a large amount of firewood, typically 2-3 times what you would use for cabin heating in the same period.</li>
              <li>You must decide if you want to commit this amount of wood to the hot tub, as it may leave less for cabin heating.</li>
              <li>Wood is provided, but using the hot tub means less wood available for other purposes during your stay.</li>
            </ul>
          )
        },
        {
          question: 'What are the winter limitations?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>In winter, heating takes significantly longer and may be impractical.</li>
              <li>Freezing risks are high. The tub may freeze if not used regularly or if the fire goes out.</li>
              <li>Heating in freezing temperatures requires constant fire maintenance and much more wood.</li>
              <li>Many guests find the hot tub impractical during winter months.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Toilet (Composting)',
      questions: [
        {
          question: 'How does the composting toilet work?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>The cabin uses a composting toilet system that does not require water or flushing.</li>
              <li>Follow the instructions provided at the cabin for proper use.</li>
              <li>Add sawdust or provided material after each use as directed.</li>
              <li>This is a manual, hands-on system that requires your participation to function correctly.</li>
            </ul>
          )
        },
        {
          question: 'What should I know about using it?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Read the instructions carefully when you arrive.</li>
              <li>Only use toilet paper that is provided or approved for composting toilets.</li>
              <li>Do not dispose of anything else in the toilet.</li>
              <li>The system requires maintenance and understanding to work properly.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Heating & Winter Preparation',
      questions: [
        {
          question: 'What is the main heating source?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>The main heat source is a wood stove located in the cabin.</li>
              <li>You must light and maintain the fire yourself throughout your stay.</li>
              <li>There is no automatic heating system.</li>
              <li>Firewood is provided, but you are responsible for keeping the fire going.</li>
            </ul>
          )
        },
        {
          question: 'Do I need to know how to use a wood stove?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Yes. You must be comfortable using and monitoring a wood stove safely.</li>
              <li>Instructions are provided, but prior experience is helpful.</li>
              <li>You need to understand how to start fires, maintain them, and operate stove controls.</li>
              <li>Safety is critical. Never leave the fire unattended when active.</li>
            </ul>
          )
        },
        {
          question: 'How cold does it get?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Nights can be very cold, especially in winter when temperatures can drop well below freezing.</li>
              <li>Even in summer, nights in the mountains are cool and require warm clothing and bedding.</li>
              <li>The cabin can get cold quickly if the fire is not maintained consistently.</li>
              <li>Bring proper warm clothing and layers regardless of the season you visit.</li>
            </ul>
          )
        },
        {
          question: 'What should I bring for winter stays?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Warm layers including thermal base layers, fleece, and insulated jackets.</li>
              <li>Warm hat, gloves, and thick socks.</li>
              <li>Warm sleeping layers as the cabin cools overnight when the fire dies down.</li>
              <li>Extra blankets if you tend to feel cold at night.</li>
              <li>Proper winter footwear for outside.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Pets',
      questions: [
        {
          question: 'Can I bring my pet?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>No. Pets are not permitted at The Cabin.</li>
              <li>The remote location and presence of wildlife make it unsuitable for pets.</li>
              <li>The area is home to protected species, and we maintain strict policies to preserve the natural ecosystem.</li>
              <li>Pet waste and disturbance can negatively impact the local wildlife and environment.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Cooking & Food Storage',
      questions: [
        {
          question: 'What cooking facilities are available?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Cooking is done on the wood stove or using alternative methods provided at the cabin.</li>
              <li>There is no conventional oven or electric stove.</li>
              <li>Basic cooking utensils and pots are provided.</li>
              <li>Cooking requires planning and adaptation to the available equipment.</li>
            </ul>
          )
        },
        {
          question: 'How do I store food?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Food storage is limited. There may be basic cool storage, but no refrigerator.</li>
              <li>Bring food that does not require refrigeration or plan accordingly.</li>
              <li>In winter, you can use the cold outside for some food storage.</li>
              <li>Store food securely to prevent attracting wildlife.</li>
            </ul>
          )
        },
        {
          question: 'Should I bring my own food?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Yes. You must bring all food and drinks for your stay.</li>
              <li>Plan meals that work with the available cooking facilities.</li>
              <li>There are no nearby shops or restaurants.</li>
              <li>Bring extra supplies in case weather delays your departure.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Activities & Nearby',
      questions: [
        {
          question: 'What can I do near the cabin?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Hiking on mountain trails surrounding the cabin.</li>
              <li>Wildlife watching and bird observation.</li>
              <li>Photography and nature observation.</li>
              <li>Reading, journaling, and quiet reflection.</li>
              <li>Relaxing by the fire or outside in nature.</li>
            </ul>
          )
        },
        {
          question: 'Are there shops or restaurants nearby?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>No. The cabin is remote with no shops or restaurants nearby.</li>
              <li>The nearest village is some distance away and requires driving.</li>
              <li>Bring everything you need for your stay.</li>
              <li>Plan your supplies carefully before arriving.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Wildlife & Safety',
      questions: [
        {
          question: 'What wildlife might I encounter?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>The area is home to various wildlife including bears, wolves, wild boar, and smaller animals.</li>
              <li>Wildlife encounters are possible but generally rare if you follow safety guidelines.</li>
              <li>Store food securely and never feed wildlife.</li>
              <li>Make noise when hiking to avoid surprising animals.</li>
            </ul>
          )
        },
        {
          question: 'What safety precautions should I take?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Read all safety information provided at the cabin.</li>
              <li>Never leave fires unattended.</li>
              <li>Store food securely away from the cabin at night if possible.</li>
              <li>Inform someone of your plans and expected return if hiking.</li>
              <li>Carry a whistle or noise maker when outside.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Communication & Connectivity',
      questions: [
        {
          question: 'Is there wifi?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>No. There is no wifi connection at the cabin.</li>
              <li>This is a full digital detox location.</li>
              <li>Emergency Starlink may be available only for property emergencies, not guest use.</li>
            </ul>
          )
        },
        {
          question: 'Is there phone signal?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Mobile reception is weak or completely absent at the cabin.</li>
              <li>Do not rely on having phone signal during your stay.</li>
              <li>Some guests find intermittent signal in certain spots, but it is unreliable.</li>
            </ul>
          )
        },
        {
          question: 'What if I have an emergency?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>In emergencies, you must walk or drive back towards the village to regain phone signal.</li>
              <li>Emergency contact information is provided in your booking confirmation.</li>
              <li>Plan accordingly and inform someone of your travel plans.</li>
              <li>Consider bringing a satellite communication device if you have serious concerns.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'What to Bring',
      questions: [
        {
          question: 'What essential items should I pack?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Power banks or battery packs for device charging.</li>
              <li>Warm layers and clothing suitable for mountain conditions, even in summer.</li>
              <li>Waterproof jacket and sturdy hiking boots.</li>
              <li>Headlamp or flashlight with extra batteries.</li>
              <li>All food and drinks for your stay.</li>
              <li>Matches or lighter for the wood stove.</li>
            </ul>
          )
        },
        {
          question: 'What should I not bring?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>High-consumption electronics or appliances (kettles, hair dryers, heaters).</li>
              <li>Devices that require standard power outlets.</li>
              <li>Pets.</li>
              <li>Expectations of modern conveniences or connectivity.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Location & Distances',
      questions: [
        {
          question: 'Where exactly is The Cabin located?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>The Cabin is located near Bachevo in the Rhodope Mountains, Bulgaria.</li>
              <li>Exact GPS coordinates and detailed directions are provided after booking confirmation.</li>
              <li>The location is remote, accessed via forest roads from the nearest main road.</li>
            </ul>
          )
        },
        {
          question: 'How far is it from major cities?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Allow several hours drive from major cities like Sofia or Plovdiv.</li>
              <li>Factor in the additional 15-20 minutes on the forest road.</li>
              <li>Plan your journey time carefully, especially in winter conditions.</li>
            </ul>
          )
        }
      ]
    },
    {
      category: 'Emergency & Host Support',
      questions: [
        {
          question: 'What if something goes wrong during my stay?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Emergency contact information is provided in your booking confirmation.</li>
              <li>You may need to travel back towards the village to get phone signal to contact us.</li>
              <li>For immediate emergencies, follow standard emergency procedures and travel to get help.</li>
              <li>Read all provided information about local emergency services before your stay.</li>
            </ul>
          )
        },
        {
          question: 'Can the host help me during my stay?',
          answer: (
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>We provide detailed instructions and information before your arrival.</li>
              <li>During your stay, immediate assistance may be limited due to the remote location.</li>
              <li>For non-emergency questions, contact us via the provided methods when you have signal.</li>
              <li>You must be self-reliant and comfortable with off-grid living for your stay.</li>
            </ul>
          )
        }
      ]
    }
  ];

  return (
    <div className="relative min-h-screen bg-[#272522] text-[#F1ECE2]">
      <Seo
        title="The Cabin FAQ | Drift & Dwells"
        description="Everything you need to know about staying at The Cabin — arrival, check-in, amenities, transport, and seasonal information."
        canonicalPath="/cabin/faq"
        jsonLd={faqJsonLd}
      />
      <section className="relative py-16 sm:py-20 md:py-24 bg-[#1c1917] border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8">
          <div className="text-center mb-8">
            <h1 className="font-['Playfair_Display'] text-4xl md:text-5xl lg:text-6xl text-[#F1ECE2] font-semibold mb-4">
              The Cabin · Full FAQ
            </h1>
            <p className="font-['Merriweather'] text-base md:text-lg text-[#F1ECE2]/80 max-w-2xl mx-auto mb-6">
              The complete manual for staying off grid at The Cabin. Read this if you want every detail about what to expect.
            </p>
            <Link
              to="/cabin"
              className="inline-block text-sm uppercase tracking-widest text-[#F1ECE2]/70 hover:text-amber-500/80 transition-colors underline underline-offset-4"
            >
              ← Back to The Cabin page
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="relative py-12 md:py-20 bg-[#272522]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8">
          <div className="space-y-8">
            {faqData.map((category, categoryIndex) => (
              <div key={categoryIndex} className="border-b border-white/10 pb-8 last:border-b-0">
                <button
                  onClick={() => toggleCategory(categoryIndex)}
                  className="w-full flex items-center justify-between text-left mb-6 hover:text-amber-500/80 transition-colors"
                >
                  <h2 className="font-serif text-2xl md:text-3xl text-[#F1ECE2]">
                    {category.category}
                  </h2>
                  <div className="flex-shrink-0 ml-4">
                    {openCategory === categoryIndex ? (
                      <Minus className="w-5 h-5 text-[#F1ECE2]/60 stroke-[1.5]" />
                    ) : (
                      <Plus className="w-5 h-5 text-[#F1ECE2]/60 stroke-[1.5]" />
                    )}
                  </div>
                </button>

                <motion.div
                  initial={false}
                  animate={{
                    height: openCategory === categoryIndex ? 'auto' : 0,
                    opacity: openCategory === categoryIndex ? 1 : 0
                  }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="space-y-0 pt-2">
                    {category.questions.map((item, questionIndex) => {
                      const key = `${categoryIndex}-${questionIndex}`;
                      return (
                        <div key={questionIndex} className="border-b border-white/5 last:border-b-0">
                          <button
                            onClick={() => toggleQuestion(categoryIndex, questionIndex)}
                            className="w-full flex items-center justify-between py-4 text-left hover:text-amber-500/80 transition-colors"
                          >
                            <h3 className="font-serif italic text-lg md:text-xl text-[#F1ECE2] pr-4">
                              {item.question}
                            </h3>
                            <div className="flex-shrink-0">
                              {openQuestion[key] ? (
                                <Minus className="w-4 h-4 text-[#F1ECE2]/60 stroke-[1.5]" />
                              ) : (
                                <Plus className="w-4 h-4 text-[#F1ECE2]/60 stroke-[1.5]" />
                              )}
                            </div>
                          </button>
                          <motion.div
                            initial={false}
                            animate={{
                              height: openQuestion[key] ? 'auto' : 0,
                              opacity: openQuestion[key] ? 1 : 0
                            }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                            className="overflow-hidden"
                          >
                            <div className="font-['Merriweather'] text-base text-[#F1ECE2]/80 leading-relaxed pb-4 pl-4">
                              {item.answer}
                            </div>
                          </motion.div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default CabinFaqPage;

























