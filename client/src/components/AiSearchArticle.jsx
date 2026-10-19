import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import Seo from './Seo';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import { useBookingSearch } from '../context/BookingSearchContext';
import { localizePath } from '../utils/localizedRoutes';
import { getSiteUrl } from '../utils/siteUrl';
import { CONTACT_EMAIL } from '../data/gmbLocations';
import { editorial, editorialPaths, editorialPhotos } from '../content/ai-search';
import '../pages/seo/ai-search.css';

function InlineCopy({ text, language }) {
  const tokens = /(\[(?:Internal link|Вътрешна връзка): [^\]]+\]|\[[^\]]+\]\(https:\/\/[^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  return text.split(tokens).filter(Boolean).map((part, index) => {
    const internal = part.match(/^\[(?:Internal link|Вътрешна връзка): (.+), (\/[^\]]+)\]$/);
    if (internal) {
      const target = localizePath(internal[2], language);
      return <Link key={index} to={`${target}/`} >{internal[1]}</Link>;
    }
    const external = part.match(/^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/);
    if (external) return <a key={index} href={external[2]}>{external[1]}</a>;
    if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function EditorialCta({ text, language, onInquiry }) {
  const arrow = text.match(/^(.+?) -> (\/\S+)$/);
  if (arrow) {
    const target = localizePath(arrow[2], language);
    return <Link className="ai-search-cta" to={`${target}/`}>{arrow[1]}</Link>;
  }
  const labels = text.split(' | ');
  if (labels.length === 2) return labels.map((label, index) => (
    <Link key={label} className="ai-search-cta" to={`${localizePath(index === 0 ? '/cabin' : '/valley', language)}/`}>{label}</Link>
  ));
  return <button className="ai-search-cta" type="button" onClick={onInquiry}>{text.replace(/\s*\[[^\]]+\]$/, '')}</button>;
}

export default function AiSearchArticle({ kind, children }) {
  const { language } = useSiteLanguage();
  const { openModal } = useBookingSearch();
  const copy = editorial[kind][language];
  const basePath = editorialPaths[kind];
  const origin = getSiteUrl();
  const homePath = language === 'bg' ? '/bg/' : '/';
  const canonical = `${origin}${localizePath(basePath, language)}/`;
  const photos = editorialPhotos[kind];
  const firstSection = copy.blocks.findIndex((block) => block.type === 'h2');
  const introduction = copy.blocks.slice(0, firstSection);
  const heroCta = introduction.find((block) => block.type === 'cta');
  const introText = introduction[0].text;
  const sentenceEnd = introText.indexOf('. ');
  const heroIntro = sentenceEnd < 0 ? introText : introText.slice(0, sentenceEnd + 1);
  const introContinuation = introText.slice(heroIntro.length).trim();
  const sections = [];
  for (const block of copy.blocks.slice(firstSection)) {
    if (block.type === 'h2') sections.push({ heading: block.text, blocks: [] });
    else sections[sections.length - 1].blocks.push(block);
  }
  const labels = language === 'bg' ? {
    offGrid: 'Изберете своето място', detox: 'Разгледайте всички места', corporate: 'Разгледайте цялата The Valley',
    contents: 'В този пътеводител', contact: 'Свържете се с нас'
  } : {
    offGrid: 'Find your stay', detox: 'Explore all stays', corporate: 'Explore the whole Valley',
    contents: 'In this guide', contact: 'Get in touch'
  };
  const renderBlock = (block, index) => {
    if (block.type === 'h3') return <h3 key={index}><InlineCopy text={block.text} language={language} /></h3>;
    if (block.type === 'list') return <ul key={index}>{block.items.map((item) => <li key={item}><InlineCopy text={item} language={language} /></li>)}</ul>;
    if (block.type === 'cta') return <div key={index} className="ai-search-actions"><EditorialCta text={block.text} language={language} onInquiry={openModal} /></div>;
    return <p key={index}><InlineCopy text={block.text} language={language} /></p>;
  };
  const photoFigure = (photo, hero = false) => (
    <figure key={photo.src} className={`ai-search-photos ai-search-photo${hero ? ' ai-search-hero-photo' : ''}`}>
      <img src={photo.src} alt={photo[language]} width="1200" height={photo.height}
        srcSet={`${photo.src.replace('-1200w.', '-720w.')} 720w, ${photo.src} 1200w`}
        sizes={hero ? '(min-width: 1000px) 1200px, 100vw' : '(min-width: 1200px) 1120px, 100vw'}
        loading={hero ? 'eager' : 'lazy'} decoding="async" />
      <figcaption>{photo[language]}</figcaption>
    </figure>
  );
  const entities = kind === 'corporate' ? ['valley', 'retreats/the-valley']
    : kind === 'detox' ? ['cabin', 'stays/lux-cabin', 'stays/a-frame', 'stays/stone-house'] : ['cabin', 'valley'];
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': `${canonical}#webpage`,
      url: canonical,
      name: copy.heading,
      description: copy.description,
      inLanguage: language,
      isPartOf: { '@type': 'WebSite', url: `${origin}/`, name: 'Drift & Dwells' },
      publisher: { '@id': `${origin}#organization` },
      about: entities.map((entity) => ({ '@id': `${origin}/${entity}/#lodging` })),
      primaryImageOfPage: { '@type': 'ImageObject', contentUrl: `${origin}${photos[0].src}`, caption: photos[0][language] }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: language === 'bg' ? 'Начало' : 'Home', item: `${origin}${homePath}` },
        { '@type': 'ListItem', position: 2, name: copy.heading, item: canonical }
      ]
    }
  ];
  return (
    <article className="ai-search" data-kind={kind}>
      <Seo title={copy.title} description={copy.description} ogTitle={copy.socialTitle} canonicalPath={basePath} jsonLd={jsonLd} />
      <div className="ai-search-container">
        <nav aria-label={language === 'bg' ? 'Навигационна пътека' : 'Breadcrumb'}>
          <ol className="ai-search-breadcrumb">
            <li><Link to={homePath}>{language === 'bg' ? 'Начало' : 'Home'}</Link></li>
            <li aria-current="page">{copy.heading}</li>
          </ol>
        </nav>
        <div className="ai-search-hero">
          <div className="ai-search-hero-copy">
            <span className="ai-search-eyebrow">Drift &amp; Dwells · {kind === 'corporate' ? 'The Valley' : language === 'bg' ? 'България' : 'Bulgaria'}</span>
            <h1>{copy.heading}</h1>
            <p className="ai-search-hero-intro"><InlineCopy text={heroIntro} language={language} /></p>
            <div className="ai-search-actions">
              {heroCta ? <EditorialCta text={heroCta.text} language={language} onInquiry={openModal} /> : kind === 'offGrid'
                ? <a className="ai-search-cta" href="#stays">{labels.offGrid}</a>
                : <Link className="ai-search-cta" to={`${localizePath(kind === 'detox' ? '/off-grid-cabins-bulgaria' : '/retreats/the-valley', language)}/`}>{labels[kind]}</Link>}
            </div>
          </div>
          {photoFigure(photos[0], true)}
        </div>
        <div className="ai-search-summary">
          {introContinuation && <p className="ai-search-intro-continuation"><InlineCopy text={introContinuation} language={language} /></p>}
          {introduction.slice(1).filter((block) => block !== heroCta).map(renderBlock)}
        </div>
        {children}
        <nav className="ai-search-contents" aria-label={labels.contents}>
          <span className="ai-search-eyebrow">{labels.contents}</span>
          <ol>{sections.map((section, index) => <li key={section.heading}><a href={`#guide-${index + 1}`}>{section.heading}</a></li>)}</ol>
        </nav>
        <div className="ai-search-editorial">
          {sections.map((section, index) => (
            <Fragment key={section.heading}>
              <section className="ai-search-section" id={`guide-${index + 1}`}>
                <div className="ai-search-section-heading">
                  <span className="ai-search-eyebrow" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <h2><InlineCopy text={section.heading} language={language} /></h2>
                </div>
                <div className="ai-search-prose">{section.blocks.map(renderBlock)}</div>
              </section>
              {index === 1 && <div className="ai-search-interlude">{photos.slice(1).map((photo) => photoFigure(photo))}</div>}
            </Fragment>
          ))}
        </div>
        <div className="ai-search-contact"><span className="ai-search-eyebrow">{labels.contact}</span><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></div>
      </div>
    </article>
  );
}
