import { Fragment } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Seo from '../../components/Seo'
import { getLanguageFromPath } from '../../utils/localizedRoutes'
import copy from '../../content/commercialSeoCopy.json'
import './commercial-seo.css'

const images = {
  'forest-cabin-for-two-bulgaria': '/media/hero/cabin-summer-1200w.webp',
  'romantic-mountain-getaway-bulgaria': '/media/hero/cabin-winter-1200w.webp',
  'rhodope-mountain-cabins': '/media/seo/aframe-site-wide.jpeg',
  'a-frame-cabins-bulgaria': '/media/seo/aframe-field-sunset.jpeg',
  'romantic-cabin-near-bansko': '/media/hero/cabin-summer-1200w.webp'
}

const preferredStay = {
  'forest-cabin-for-two-bulgaria': '/cabin',
  'romantic-mountain-getaway-bulgaria': '/cabin',
  'rhodope-mountain-cabins': '/valley',
  'a-frame-cabins-bulgaria': '/valley',
  'romantic-cabin-near-bansko': '/cabin'
}

function InlineCopy({ value }) {
  const chunks = value.split(/(\[[^\]]+\]\(\/[^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean)
  return chunks.map((chunk, index) => {
    const internalLink = chunk.match(/^\[([^\]]+)\]\((\/[^)]+)\)$/)
    if (internalLink) return <Link key={index} to={internalLink[2]}>{internalLink[1]}</Link>
    if (chunk.startsWith('**') && chunk.endsWith('**')) return <strong key={index}>{chunk.slice(2, -2)}</strong>
    if (chunk.startsWith('*') && chunk.endsWith('*')) return <em key={index}>{chunk.slice(1, -1)}</em>
    return <Fragment key={index}>{chunk}</Fragment>
  })
}

export default function CommercialSeoLanding({ slug }) {
  const { pathname } = useLocation()
  const language = getLanguageFromPath(pathname)
  const page = copy[slug]?.[language]
  if (!page) return null

  const canonicalPath = '/' + slug
  const localized = (path) => language === 'bg' ? '/bg' + path : path
  const canonical = 'https://driftdwells.com' + localized(canonicalPath) + '/'
  const home = language === 'bg' ? '/bg/' : '/'
  const image = images[slug]
  const primaryStay = localized(preferredStay[slug]) + '/'
  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': canonical + '#webpage',
      url: canonical,
      name: page.h1,
      description: page.description,
      inLanguage: language,
      isPartOf: { '@type': 'WebSite', name: 'Drift & Dwells', url: 'https://driftdwells.com/' }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: language === 'bg' ? 'Начало' : 'Home', item: 'https://driftdwells.com' + home },
        { '@type': 'ListItem', position: 2, name: page.h1, item: canonical }
      ]
    }
  ]
  const intro = page.blocks.findIndex((block) => block.type === 'p')
  const primary = page.blocks[intro]
  const rest = page.blocks.filter((_, index) => index !== intro)

  return (
    <article className="dd-commercial">
      <Seo title={page.title} description={page.description} canonicalPath={canonicalPath} ogImage={image} jsonLd={schema} />
      <div className="dd-commercial-wrap">
        <nav className="dd-commercial-breadcrumb" aria-label={language === 'bg' ? 'Навигация' : 'Breadcrumb'}>
          <Link to={home}>{language === 'bg' ? 'Начало' : 'Home'}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{page.h1}</span>
        </nav>
        <header className="dd-commercial-hero">
          <div className="dd-commercial-hero-copy">
            <p className="dd-commercial-eyebrow">DRIFT & DWELLS · {language === 'bg' ? 'БЪЛГАРИЯ' : 'BULGARIA'}</p>
            <h1>{page.h1}</h1>
            {primary && <p className="dd-commercial-lede"><InlineCopy value={primary.text} /></p>}
            <Link className="dd-commercial-button" to={primaryStay}>
              {language === 'bg' ? 'Разгледайте свободните дати' : 'Explore stays and availability'}
            </Link>
          </div>
          <img className="dd-commercial-hero-image" src={image} alt={page.h1} width="1200" height="800" loading="eager" decoding="async" />
        </header>
        <div className="dd-commercial-content">
          {rest.map((block, index) => {
            if (block.type === 'h2') return <h2 key={index}>{block.text}</h2>
            if (block.type === 'h3') return <h3 key={index}>{block.text}</h3>
            const action = block.text.match(/^\[([^\]]+)\]\((\/[^)]+)\)$/)
            if (action) return <p className="dd-commercial-action" key={index}><Link to={action[2]}>{action[1]}</Link></p>
            return <p key={index}><InlineCopy value={block.text} /></p>
          })}
        </div>
        <section className="dd-commercial-footer">
          <p className="dd-commercial-eyebrow">DRIFT & DWELLS</p>
          <h2>{language === 'bg' ? 'Изберете своята почивка' : 'Find your place in the mountains'}</h2>
          <Link className="dd-commercial-button" to={primaryStay}>
            {language === 'bg' ? 'Вижте свободните дати' : 'Check availability'}
          </Link>
          <Link className="dd-commercial-secondary" to={localized('/off-grid-cabins-bulgaria') + '/'}>
            {language === 'bg' ? 'Разгледайте всички места' : 'Explore all stays'}
          </Link>
        </section>
      </div>
    </article>
  )
}
