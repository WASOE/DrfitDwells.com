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
  const entities = kind === 'corporate' ? ['valley', 'retreats/the-valley']
    : kind === 'detox' ? ['cabin'] : ['cabin', 'valley'];
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
    <article className="ai-search">
      <Seo title={copy.title} description={copy.description} ogTitle={copy.socialTitle} canonicalPath={basePath} jsonLd={jsonLd} />
      <div className="ai-search-container">
        <nav aria-label={language === 'bg' ? 'Навигационна пътека' : 'Breadcrumb'}>
          <ol className="ai-search-breadcrumb">
            <li><Link to={homePath}>{language === 'bg' ? 'Начало' : 'Home'}</Link></li>
            <li aria-current="page">{copy.heading}</li>
          </ol>
        </nav>
        <h1>{copy.heading}</h1>
        {copy.blocks.map((block, index) => (
          <Fragment key={index}>
            {block.type === 'h2' ? <h2><InlineCopy text={block.text} language={language} /></h2>
              : block.type === 'h3' ? <h3><InlineCopy text={block.text} language={language} /></h3>
                : block.type === 'list' ? <ul>{block.items.map((item) => <li key={item}><InlineCopy text={item} language={language} /></li>)}</ul>
                  : block.type === 'cta' ? <div className="ai-search-actions"><EditorialCta text={block.text} language={language} onInquiry={openModal} /></div>
                    : <p><InlineCopy text={block.text} language={language} /></p>}
            {index === 1 && (
              <>
                <div className="ai-search-photos">
                  {photos.map((photo, photoIndex) => (
                    <figure key={photo.src}>
                      <img src={photo.src} alt={photo[language]} width="1200" height={photo.height}
                        srcSet={`${photo.src.replace('-1200w.', '-720w.')} 720w, ${photo.src} 1200w`}
                        sizes="(min-width: 768px) 33vw, 100vw"
                        loading={photoIndex === 0 ? 'eager' : 'lazy'} decoding="async" />
                      <figcaption>{photo[language]}</figcaption>
                    </figure>
                  ))}
                </div>
                {children}
              </>
            )}
          </Fragment>
        ))}
        <p><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
      </div>
    </article>
  );
}
