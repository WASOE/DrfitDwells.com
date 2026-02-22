import { motion } from 'framer-motion';
import { useInView } from 'framer-motion';
import { useRef } from 'react';

const StorySection = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  // Split story into chapters
  const chapters = [
    {
      title: 'Before',
      paragraphs: [
        'I used to live in the Netherlands and work like it was the only thing that mattered.',
        'It worked, until it did not.',
        'I burned out.'
      ]
    },
    {
      title: 'The road',
      paragraphs: [
        'Then Covid arrived and the world slowed down. I did the opposite. I left in a campervan, not to "find myself", just to feel normal again.',
        'I drove, kept driving, and ended up in Bulgaria.'
      ]
    },
    {
      title: 'The land',
      paragraphs: [
        'One day I saw a piece of land. I cannot explain it better than this: it felt obvious. I bought it on the spot. No spreadsheets. No strategy deck. Just a decision.',
        'Then reality showed up.'
      ]
    },
    {
      title: 'The winter',
      paragraphs: [
        'I started building the first cabin in the middle of winter. Nights went to minus 25. The wood was frozen. The ground was hard. The site had no signal.',
        'So I learned the way you learn when you have no other choice.',
        'I would drive until I found coverage, download YouTube videos, and bring them back like supplies. Sometimes the video was wrong. Sometimes I was wrong. And when that happened, I had to walk long distances to the top of a hill just to get enough signal to figure out what to do next.',
        'It was slow. It was frustrating. It was also exactly what my head needed.',
        'Because while I was solving simple problems with my hands, the bigger problem started to loosen its grip.',
        'The cabin did something to me.',
        'Not in a mystical way. In a practical way. It gave me quiet. It gave me cold air and silence and the kind of tiredness that lets you sleep.'
      ]
    },
    {
      title: 'The first guests',
      paragraphs: [
        'When it was ready, I put it on Airbnb.',
        'Not because I had a hospitality brand in mind.',
        'Because I thought: if this place can pull me out of burnout, maybe it can help someone else breathe again.',
        'People came. And I kept hearing the same thing in different words.',
        'I slept.',
        'I slowed down.',
        'I feel normal again.'
      ]
    },
    {
      title: 'The direction',
      paragraphs: [
        'That is when Drift & Dwells stopped being a cabin.',
        'It became a direction.',
        'We built more. We started selling cabins to the Netherlands. We began working on The Valley, our next off grid chapter.',
        'And somehow, the first cabin became the number one cabin on Airbnb.',
        'I still think that happened for a simple reason.',
        'It is real.',
        'It is made with care.',
        'And it works.',
        'That is the story.',
        'Not a masterplan.',
        'Just one decision, one winter, one cabin, and the quiet that followed.'
      ]
    }
  ];

  const pullQuotes = [
    { text: 'It worked, until it did not.', chapterIndex: 0 },
    { text: 'Just one decision, one winter, one cabin, and the quiet that followed.', chapterIndex: 5 }
  ];

  return (
    <section ref={ref} className="valley-section">
      <div className="valley-container">
        <div className="max-w-[700px] mx-auto">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: 0.6 }}
            className="valley-h2 mb-16"
          >
            The story
          </motion.h2>

          <div className="story-reading-layout">
            {chapters.map((chapter, chapterIndex) => {
              const pullQuote = pullQuotes.find(pq => pq.chapterIndex === chapterIndex);
              
              return (
                <motion.div
                  key={chapter.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                  transition={{ duration: 0.6, delay: chapterIndex * 0.1 }}
                  className="mb-20 last:mb-0"
                >
                  {/* Chapter Heading */}
                  <h3 
                    className="text-sm uppercase tracking-wider mb-8"
                    style={{ 
                      color: 'var(--valley-text-subtle)',
                      fontFamily: 'var(--valley-font-primary)',
                      fontWeight: 500,
                      letterSpacing: '0.15em'
                    }}
                  >
                    {chapter.title}
                  </h3>

                  {/* Pull Quote (if this chapter has one) */}
                  {pullQuote && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                      transition={{ duration: 0.6, delay: chapterIndex * 0.1 + 0.2 }}
                      className="story-pull-quote mb-10"
                    >
                      <p className="story-pull-quote-text">{pullQuote.text}</p>
                    </motion.div>
                  )}

                  {/* Chapter Paragraphs */}
                  <div className="story-paragraphs">
                    {chapter.paragraphs.map((paragraph, paraIndex) => (
                      <div key={paraIndex} className="story-paragraph-wrapper">
                        <p className="story-body-text">
                          {paragraph}
                        </p>
                        {paraIndex < chapter.paragraphs.length - 1 && (
                          <div className="story-paragraph-separator" />
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default StorySection;
