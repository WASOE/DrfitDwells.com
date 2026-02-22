import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingSearch } from '../../../context/BookingSearchContext';
import { getSEOAlt, getSEOTitle } from '../../../data/imageMetadata';
import { STAY_CARDS } from '../data';

const StaysSection = ({ accommodationsRef }) => {
  const { openModal } = useBookingSearch();
  const navigate = useNavigate();
  const [cabinIdByName, setCabinIdByName] = useState({});

  useEffect(() => {
    let active = true;

    const loadCabins = async () => {
      try {
        const response = await fetch('/api/cabins');
        const payload = await response.json();
        if (!active || !payload?.success) return;

        const map = {};
        (payload.data?.cabins || []).forEach((cabin) => {
          if (!cabin?.name || !cabin?._id) return;
          map[cabin.name.trim().toLowerCase()] = cabin._id;
        });
        setCabinIdByName(map);
      } catch (error) {
        console.error('Failed to load cabins for stay cards:', error);
      }
    };

    loadCabins();
    return () => {
      active = false;
    };
  }, []);

  const cardLinks = useMemo(() => {
    const map = {};
    STAY_CARDS.forEach((card) => {
      if (card.route) {
        map[card.id] = card.route;
        return;
      }
      const lookupName = (card.backendName || card.title || '').trim().toLowerCase();
      if (lookupName && cabinIdByName[lookupName]) {
        map[card.id] = `/cabin/${cabinIdByName[lookupName]}`;
      }
    });
    return map;
  }, [cabinIdByName]);

  const handleCardAction = (card) => {
    const href = cardLinks[card.id];
    if (href) {
      navigate(href);
    } else {
      openModal();
    }
  };

  return (
    <section 
      ref={accommodationsRef}
      id="accommodations"
      className="valley-section"
    >
      <div className="valley-container">
        {/* H2 - Section Title */}
        <h2 className="font-['Montserrat'] text-[#1a1a1a] mb-8 stays-section-title" style={{ fontSize: '48px', fontWeight: 800 }}>
          <style>{`
            @media (max-width: 768px) {
              .stays-section-title {
                font-size: 34px !important;
              }
            }
          `}</style>
          Stays
        </h2>

        {/* Intro Sentence */}
        <p className="font-['Montserrat'] mb-16 max-w-3xl stays-intro" style={{ fontSize: '18px', fontWeight: 500 }}>
          <style>{`
            @media (max-width: 768px) {
              .stays-intro {
                font-size: 16px !important;
              }
            }
          `}</style>
          Choose your stay.
        </p>

        {/* Compare Strip - Aligned Under Intro */}
        <div className="mb-12 border border-[rgba(0,0,0,0.12)] rounded-xl overflow-hidden bg-white">
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[rgba(0,0,0,0.12)]">
            {STAY_CARDS.map((stay, index) => (
              <div key={index} className="p-6 md:p-8">
                <h3 className="text-lg font-semibold text-[#1a1a1a] mb-4">{stay.title}</h3>
                <div className="space-y-2 valley-body text-[#4a4a4a]">
                  <div><strong className="text-[#1a1a1a] font-semibold">Sleeps:</strong> {stay.sleeps}</div>
                  <div><strong className="text-[#1a1a1a] font-semibold">Best for:</strong> {stay.id === 'stone-house' ? 'families or small groups' : stay.id === 'a-frames' ? 'solo travelers or couples' : 'couples'}</div>
                  <div><strong className="text-[#1a1a1a] font-semibold">Key feature:</strong> {stay.bullets[0]}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 3 Stay Cards - Same Baseline, Same Ratios, Same Spacing */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {STAY_CARDS.map((card, index) => (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="flex flex-col"
            >
              {/* Image - Consistent Ratio */}
              <div 
                className="relative w-full mb-6 rounded-xl overflow-hidden cursor-pointer"
                style={{ aspectRatio: '4 / 5', backgroundColor: '#e8e8e8' }}
                onClick={() => handleCardAction(card)}
              >
                <img 
                  src={card.image}
                  alt={getSEOAlt(card.imagePath) || `${card.title} at The Valley showing comfortable space and mountain views`}
                  title={getSEOTitle(card.imagePath) || `${card.title} - Mountain Retreat at The Valley`}
                  className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                  loading="lazy"
                  decoding="async"
                />
              </div>

              {/* Text - Aligned Baseline */}
              <div className="flex-1 flex flex-col">
                <h3 className="font-['Montserrat'] text-[#1a1a1a] mb-3 stay-card-title" style={{ fontSize: '28px', fontWeight: 600 }}>
                  <style>{`
                    @media (max-width: 768px) {
                      .stay-card-title {
                        font-size: 22px !important;
                      }
                    }
                  `}</style>
                  {card.title}
                </h3>
                <p className="font-['Montserrat'] text-[#4a4a4a] mb-5" style={{ fontSize: '13px', fontWeight: 400, opacity: 0.65 }}>{card.bullets[0]}</p>
                
                {/* CTAs */}
                <div className="flex items-center gap-6 mt-auto pt-4 border-t border-[rgba(0,0,0,0.12)]">
                  <button
                    onClick={() => handleCardAction(card)}
                    className="text-[#1a1a1a] font-semibold hover:text-[#81887A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A]"
                  >
                    Check dates
                  </button>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      handleCardAction(card);
                    }}
                    className="text-[#6a6a6a] text-sm hover:text-[#1a1a1a] transition-colors underline underline-offset-4"
                  >
                    View details
                  </a>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StaysSection;
