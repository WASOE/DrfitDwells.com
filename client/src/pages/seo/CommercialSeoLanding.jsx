import { Fragment } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Seo from '../../components/Seo'
import { getLanguageFromPath } from '../../utils/localizedRoutes'
import { getSiteUrl } from '../../utils/siteUrl'
import { CONTACT_EMAIL } from '../../data/gmbLocations'
import content from '../../content/commercialSeoCopy.json'
import './ai-search.css'
import './commercial-seo.css'

// Match the approved /retreat-venue-bulgaria/ editorial markup and stylesheet.
// This component renders only the five newly added commercial page families.
const photographs = {
  "forest-cabin-for-two-bulgaria": [
    [
      "/media/ai-search/cabin-exterior-1200w.webp",
      "The Cabin in the forest near Bachevo.",
      "The Cabin сред гората край Бачево."
    ],
    [
      "/media/ai-search/cabin-forest-1200w.webp",
      "The secluded forest setting of The Cabin.",
      "Усамотеното горско място на The Cabin."
    ],
    [
      "/media/ai-search/cabin-stove-1200w.webp",
      "The wood-burning stove at The Cabin.",
      "Печката на дърва в The Cabin."
    ]
  ],
  "romantic-mountain-getaway-bulgaria": [
    [
      "/media/ai-search/cabin-forest-1200w.webp",
      "The Cabin surrounded by forest.",
      "The Cabin, скрита сред дърветата."
    ],
    [
      "/media/ai-search/cabin-exterior-1200w.webp",
      "A private mountain stay at The Cabin.",
      "Усамотена почивка в The Cabin."
    ],
    [
      "/media/seo/aframe-field-sunset.jpeg",
      "The A-frame cabins at The Valley at sunset.",
      "A-frame къщичките в The Valley по залез."
    ]
  ],
  "rhodope-mountain-cabins": [
    [
      "/media/seo/aframe-site-wide.jpeg",
      "The A-frame village in the Rhodope Mountains.",
      "A-frame селището в Родопите."
    ],
    [
      "/media/seo/aframe-row-sunset.png",
      "A-frame cabins across The Valley at sunset.",
      "A-frame къщичките в The Valley по залез."
    ],
    [
      "/media/seo/stone-house-sunset-site.jpeg",
      "The Stone House in The Valley.",
      "Каменната къща в The Valley."
    ]
  ],
  "a-frame-cabins-bulgaria": [
    [
      "/media/seo/aframe-field-sunset.jpeg",
      "The A-frame cabins at The Valley.",
      "A-frame къщичките в The Valley."
    ],
    [
      "/media/seo/aframe-row-sunset.png",
      "The row of A-frames in the mountain valley.",
      "Редицата A-frame къщички в планината."
    ],
    [
      "/media/seo/aframe-bedroom-winter.jpeg",
      "Inside an A-frame cabin in winter.",
      "В A-frame къщичка през зимата."
    ]
  ],
  "romantic-cabin-near-bansko": [
    [
      "/media/ai-search/cabin-exterior-1200w.webp",
      "The Cabin near Bachevo, a quiet stay for two.",
      "The Cabin край Бачево, усамотено място за двама."
    ],
    [
      "/media/ai-search/cabin-forest-1200w.webp",
      "Forest surroundings at The Cabin.",
      "Гората около The Cabin."
    ],
    [
      "/media/seo/aframe-field-sunset.jpeg",
      "The A-frame cabins at The Valley near Chereshovo.",
      "A-frame къщичките в The Valley край Черешово."
    ]
  ]
}

const stayRoutes = {
  'forest-cabin-for-two-bulgaria': '/cabin',
  'romantic-mountain-getaway-bulgaria': '/cabin',
  'rhodope-mountain-cabins': '/valley',
  'a-frame-cabins-bulgaria': '/valley',
  'romantic-cabin-near-bansko': '/cabin'
}

function InlineCopy({ value }) {
  return value.split(/(\[[^\]]+\]\(\/[^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean).map((part, index) => {
    const internal = part.match(/^\[([^\]]+)\]\((\/[^)]+)\)$/)
    if (internal) return <Link key={index} to={internal[2]}>{internal[1]}</Link>
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>
    return <Fragment key={index}>{part}</Fragment>
  })
}

function Photo({ photo, language, hero = false }) {
  const [src, en, bg] = photo
  const caption = language === 'bg' ? bg : en
  const srcSet = src.includes('-1200w.')
    ? src.replace('-1200w.', '-720w.') + ' 720w, ' + src + ' 1200w'
    : undefined
  return (
    <figure className={'ai-search-photos ai-search-photo' + (hero ? ' ai-search-hero-photo' : '')}>
      <img
        src={src}
        srcSet={srcSet}
        sizes={hero ? '(min-width: 1000px) 560px, 100vw' : '(min-width: 1000px) 540px, 100vw'}
        alt={caption}
        width="1200"
        height="1500"
        loading={hero ? 'eager' : 'lazy'}
        decoding="async"
      />
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

function SectionBlock({ block }) {
  if (block.type === 'h3') return <h3><InlineCopy value={block.text} /></h3>
  const standaloneLink = block.text.match(/^\[([^\]]+)\]\((\/[^)]+)\)$/)
  if (standaloneLink) return (
    <div className="ai-search-actions">
      <Link to={standaloneLink[2]} className="ai-search-cta">{standaloneLink[1]}</Link>
    </div>
  )
  return <p><InlineCopy value={block.text} /></p>
}

export default function CommercialSeoLanding({ slug }) {
  const { pathname } = useLocation()
  const language = getLanguageFromPath(pathname)
  const page = content[slug]?.[language]
  const photos = photographs[slug]
  if (!page || !photos) return null

  const basePath = '/' + slug
  const localized = (path) => language === 'bg' ? '/bg' + path : path
  const origin = getSiteUrl()
  const canonical = origin + localized(basePath) + '/'
  const homePath = language === 'bg' ? '/bg/' : '/'
  const firstSection = page.blocks.findIndex((block) => block.type === 'h2')
  const introduction = page.blocks.slice(0, firstSection)
  const firstParagraph = introduction[0]?.text || ''
  const sentenceEnd = firstParagraph.indexOf('. ')
  const heroIntro = sentenceEnd < 0 ? firstParagraph : firstParagraph.slice(0, sentenceEnd + 1)
  const introContinuation = firstParagraph.slice(heroIntro.length).trim()
  const sections = []
  for (const block of page.blocks.slice(firstSection)) {
    if (block.type === 'h2') sections.push({ heading: block.text, blocks: [] })
    else if (sections.length) sections[sections.length - 1].blocks.push(block)
  }
  const stayPath = localized(stayRoutes[slug]) + '/'
  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': canonical + '#webpage',
      url: canonical,
      name: page.h1,
      description: page.description,
      inLanguage: language,
      isPartOf: { '@type': 'WebSite', url: origin + '/', name: 'Drift & Dwells' },
      primaryImageOfPage: {
        '@type': 'ImageObject',
        contentUrl: origin + photos[0][0],
        caption: photos[0][language === 'bg' ? 2 : 1]
      }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: language === 'bg' ? 'Начало' : 'Home', item: origin + homePath },
        { '@type': 'ListItem', position: 2, name: page.h1, item: canonical }
      ]
    }
  ]
  const labels = language === 'bg'
    ? { explore: 'Разгледайте мястото и датите', guide: 'В този пътеводител', contact: 'Свържете се с нас' }
    : { explore: 'Explore stays and availability', guide: 'In this guide', contact: 'Get in touch' }

  return (
    <article className="ai-search" data-kind="commercial">
      <Seo title={page.title} description={page.description} canonicalPath={basePath} ogImage={photos[0][0]} jsonLd={schema} />
      <div className="ai-search-container">
        <nav aria-label={language === 'bg' ? 'Навигационна пътека' : 'Breadcrumb'}>
          <ol className="ai-search-breadcrumb">
            <li><Link to={homePath}>{language === 'bg' ? 'Начало' : 'Home'}</Link></li>
            <li aria-current="page">{page.h1}</li>
          </ol>
        </nav>
        <div className="ai-search-hero">
          <div className="ai-search-hero-copy">
            <span className="ai-search-eyebrow">Drift &amp; Dwells · {language === 'bg' ? 'България' : 'Bulgaria'}</span>
            <h1>{page.h1}</h1>
            <p className="ai-search-hero-intro"><InlineCopy value={heroIntro} /></p>
            <div className="ai-search-actions">
              <Link className="ai-search-cta" to={stayPath}>{labels.explore}</Link>
            </div>
          </div>
          <Photo photo={photos[0]} language={language} hero />
        </div>

        <div className="ai-search-summary">
          {introContinuation && <p className="ai-search-intro-continuation"><InlineCopy value={introContinuation} /></p>}
          {introduction.slice(1).map((block, index) => <SectionBlock block={block} key={index} />)}
        </div>

        <nav className="ai-search-contents" aria-label={labels.guide}>
          <span className="ai-search-eyebrow">{labels.guide}</span>
          <ol>{sections.map((section, index) => (
            <li key={index}><a href={'#guide-' + (index + 1)}>{section.heading}</a></li>
          ))}</ol>
        </nav>

        <div className="ai-search-editorial">
          {sections.map((section, index) => (
            <Fragment key={index}>
              <section className="ai-search-section" id={'guide-' + (index + 1)}>
                <div className="ai-search-section-heading">
                  <span className="ai-search-eyebrow" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <h2>{section.heading}</h2>
                </div>
                <div className="ai-search-prose">
                  {section.blocks.map((block, blockIndex) => <SectionBlock block={block} key={blockIndex} />)}
                </div>
              </section>
              {index === 1 && (
                <div className="ai-search-interlude">
                  {photos.slice(1).map((photo) => <Photo key={photo[0]} photo={photo} language={language} />)}
                </div>
              )}
            </Fragment>
          ))}
        </div>

        <div className="ai-search-contact">
          <span className="ai-search-eyebrow">{labels.contact}</span>
          <a href={'mailto:' + CONTACT_EMAIL}>{CONTACT_EMAIL}</a>
        </div>
      </div>
    </article>
  )
}
