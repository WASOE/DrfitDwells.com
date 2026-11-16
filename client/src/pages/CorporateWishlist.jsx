import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import Seo from '../components/Seo';
import api from '../services/api';
import { getAttributionPayload } from '../tracking/attribution';
import { normalizeCompanyWebsite } from '../utils/normalizeCompanyWebsite';
import './CorporateWishlist.css';

const copy = {
  en: {
    title: 'Dear HR, we have enough mugs.',
    titleFirst: 'Dear HR,', titleMiddle: 'we have', titleLast: 'enough mugs.',
    seo: 'Dear HR, we have enough mugs | Drift & Dwells',
    description: 'This Christmas, drop a private hint for a mountain escape instead of another company-branded gift. Discover Drift & Dwells corporate gifts.',
    kicker: 'A little Christmas wish',
    lead: 'This Christmas, we’d rather have a cabin in the mountains than another company-branded object.',
    action: 'Drop a hint to HR', privacy: 'No employee name or email. No awkward conversations.',
    heroNote: 'less stuff, more stories', heroStamp: 'A MUCH BETTER\nOUT OF OFFICE',
    scroll: 'THE CASE FOR A BETTER GIFT', jokeKicker: 'THE USUAL SUSPECTS / 01',
    jokeTitle: 'Your logo looks great. Just not on everything.',
    jokeLead: 'We love the thought. We really do. But our cupboards have filed a formal complaint.',
    mugLabel: 'The mug', mugNote: 'The cupboard is full.',
    penLabel: 'The pen', penNote: 'Already mysteriously missing.',
    notebookLabel: 'The notebook', notebookNote: 'Another one? Groundbreaking.',
    swap: 'MAY WE SUGGEST A SMALL UPGRADE?', revealKicker: 'THE ALTERNATIVE / 02',
    revealTitle: 'Less merchandise. More mountains.',
    revealLead: 'A cabin in the woods. A slow morning in the valley. The kind of gift that becomes a story, not another thing in a drawer.',
    photoCaption: 'The Valley, Bulgaria', photoAlt: 'A couple in bed looking out at snowy woods from the Christmas-decorated cabin', photoNote: 'yes, this could be your gift',
    revealAlt: 'A-frame cabins in a forest clearing at sunset',
    revealFoot: 'THE CABIN · THE VALLEY · GIFT VOUCHERS',
    formKicker: 'THE HINT / 03', formTitle: 'Let’s put a little bug in HR’s ear.',
    formLead: 'Nominate your company and leave the awkward part out of it.',
    nomination: 'Employee nomination', hr: 'Buying for a team?',
    personal: 'Hint a loved one ;)',
    personalTitle: 'A little hint for someone you love.',
    personalLead: 'For your partner, a friend, or someone who always asks what you’d like.',
    personalIntro: 'A slow morning, fresh mountain air, a Drift & Dwells stay. Let someone know you’d love one as a gift. Edit your message, then choose how to share it.',
    personalMessage: 'Your message',
    personalDefault: 'A little hint ;) I’d love a Drift & Dwells stay as a gift. Time in the mountains and memories together sound pretty perfect to me.',
    personalSubject: 'A little gift hint ;)',
    giftLink: 'Gift-voucher link', whatsapp: 'WhatsApp', emailShare: 'Email', copyLink: 'Copy Link',
    copied: 'Gift-voucher link copied.',
    copyError: 'We couldn’t copy the link. Select and copy the gift-voucher link above.',
    personalPrivacy: 'Nothing is sent automatically or submitted to our team. You choose who to share with and when.',
    modeLegend: 'Choose how to take part', nominationIntro: 'No employee name or email needed. Your suggestion is private and reviewed by our team; we never contact your company automatically.',
    hrIntro: 'Tell us a little about your team. This is a request for a proposal, not a payment or an order.',
    company: 'Company name', website: 'Company website or contact URL', websiteOptional: 'Company website (optional)', websiteHint: 'company.com',
    hrContact: 'HR contact name (optional)', hrEmail: 'HR email address', contactRequired: 'Provide an HR email address or company website/contact URL.',
    contactInvalid: 'Enter a valid email and an http or https website URL without credentials.', requiredFields: 'Please complete the required fields.', contactName: 'Your name', contactEmail: 'Work email',
    employeeCount: 'Number of employees (optional)', budget: 'Approximate budget (optional)', message: 'Anything else? (optional)',
    consentNomination: 'I understand this nomination is private, reviewed manually, and will not automatically contact the company.',
    consentHr: 'I agree to be contacted about this request and understand no payment is taken.',
    sendNomination: 'Drop the hint', sendHr: 'Request a proposal', sending: 'Sending…',
    error: 'We could not save your request. Please check your details and try again.',
    thanks: 'Hint dropped.', hrThanks: 'Message received.',
    nominationDone: 'Your nomination is safely with our team for private review. We won’t automatically contact your company.',
    hrDone: 'Your request is with our team. We’ll review your details and get back to you; no payment has been taken.',
    successNote: 'the mountains are rooting for you',
    faq: 'A LITTLE FINE PRINT', questions: [
      ['Will you contact my employer?', 'A nomination is reviewed privately by our team. It never automatically triggers contact with your company.'],
      ['Buying for a team?', 'Switch to the HR option above to request a proposal. There is no payment at this stage.']
    ]
  },
  bg: {
    title: 'Скъпи HR, имаме достатъчно чаши.',
    titleFirst: 'Скъпи HR,', titleMiddle: 'имаме', titleLast: 'достатъчно чаши.',
    seo: 'Скъпи HR, имаме достатъчно чаши | Drift & Dwells',
    description: 'Тази Коледа предложете поверително планинско бягство вместо още един подарък с фирмено лого. Открийте подаръците на Drift & Dwells.',
    kicker: 'Едно малко коледно желание',
    lead: 'Тази Коледа предпочитаме къща в планината пред още един предмет с фирмено лого.',
    action: 'Подскажете на HR', privacy: 'Без име или имейл на служител. Без неудобни разговори.',
    heroNote: 'по-малко вещи, повече истории', heroStamp: 'МНОГО ПО-ДОБЪР\nOUT OF OFFICE',
    scroll: 'ВРЕМЕ Е ЗА ПО-ДОБЪР ПОДАРЪК', jokeKicker: 'ОБИЧАЙНИТЕ ЗАПОДОЗРЕНИ / 01',
    jokeTitle: 'Логото ви е чудесно. Просто не върху всичко.',
    jokeLead: 'Оценяваме жеста. Наистина. Но шкафовете ни подадоха официална жалба.',
    mugLabel: 'Чашата', mugNote: 'Шкафът е пълен.',
    penLabel: 'Химикалката', penNote: 'Вече мистериозно изчезна.',
    notebookLabel: 'Бележникът', notebookNote: 'Още един? Невероятно.',
    swap: 'МОЖЕ ЛИ ДА ПРЕДЛОЖИМ НЕЩО ПО-ДОБРО?', revealKicker: 'АЛТЕРНАТИВАТА / 02',
    revealTitle: 'По-малко вещи. Повече планини.',
    revealLead: 'Къща в гората. Спокойна утрин в долината. Подарък, който се превръща в история, а не в още една вещ в чекмеджето.',
    photoCaption: 'Долината, България', photoAlt: 'Двойка в леглото гледа към заснежената гора от коледно украсената къща', photoNote: 'да, това може да е вашият подарък',
    revealAlt: 'A-frame къщички на горска поляна по залез',
    revealFoot: 'КЪЩАТА · ДОЛИНАТА · ПОДАРЪЧНИ ВАУЧЕРИ',
    formKicker: 'ПОДСКАЗКАТА / 03', formTitle: 'Нека подшушнем на HR.',
    formLead: 'Предложете компанията си, без неудобната част.',
    nomination: 'Предложение от служител', hr: 'Купувате за екип?',
    personal: 'Подскажи на любим човек ;)',
    personalTitle: 'Малка подсказка за любим човек.',
    personalLead: 'За половинката, приятел или някого, който все пита какъв подарък искаш.',
    personalIntro: 'Спокойна сутрин, чист планински въздух и престой в Drift & Dwells. Подскажи на близък човек, че мечтаеш за такъв подарък. Редактирай съобщението и избери как да го споделиш.',
    personalMessage: 'Твоето съобщение',
    personalDefault: 'Една малка подсказка ;) Мечтая си за престой в Drift & Dwells като подарък. Време в планината и общи спомени — звучи ми прекрасно!',
    personalSubject: 'Малка подсказка за подарък ;)',
    giftLink: 'Линк към подаръчните ваучери', whatsapp: 'WhatsApp', emailShare: 'Имейл', copyLink: 'Копирай линка',
    copied: 'Линкът към подаръчните ваучери е копиран.',
    copyError: 'Не успяхме да копираме линка. Маркирай и копирай линка към ваучерите по-горе.',
    personalPrivacy: 'Нищо не се изпраща автоматично или към нашия екип. Ти избираш с кого и кога да споделиш.',
    modeLegend: 'Изберете как да участвате', nominationIntro: 'Не са нужни име или имейл на служител. Предложението е поверително, разглежда се от екипа ни и не води до автоматичен контакт с компанията.',
    hrIntro: 'Разкажете ни за екипа си. Това е запитване за оферта, а не плащане или поръчка.',
    company: 'Име на компанията', website: 'Уебсайт на компанията или адрес за контакт', websiteOptional: 'Уебсайт на компанията (по избор)', websiteHint: 'company.bg',
    hrContact: 'Име на HR контакт (по избор)', hrEmail: 'Имейл адрес на HR', contactRequired: 'Посочете имейл на HR или уебсайт/адрес за контакт на компанията.',
    contactInvalid: 'Въведете валиден имейл и http или https адрес без потребителско име и парола.', requiredFields: 'Моля, попълнете задължителните полета.', contactName: 'Вашето име', contactEmail: 'Служебен имейл',
    employeeCount: 'Брой служители (по избор)', budget: 'Приблизителен бюджет (по избор)', message: 'Нещо друго? (по избор)',
    consentNomination: 'Разбирам, че предложението е поверително, разглежда се лично и не води до автоматичен контакт с компанията.',
    consentHr: 'Съгласен/съгласна съм да се свържете с мен относно запитването и разбирам, че не се извършва плащане.',
    sendNomination: 'Изпратете подсказката', sendHr: 'Поискайте оферта', sending: 'Изпращане…',
    error: 'Не успяхме да запазим запитването. Проверете данните и опитайте отново.',
    thanks: 'Подсказката е изпратена.', hrThanks: 'Получихме запитването.',
    nominationDone: 'Предложението ви е при нашия екип за поверителен преглед. Няма да се свържем автоматично с компанията.',
    hrDone: 'Запитването ви е при нашия екип. Ще разгледаме данните и ще ви отговорим; не е извършено плащане.',
    successNote: 'планината стиска палци',
    faq: 'МАЛКО ВАЖНИ ДЕТАЙЛИ', questions: [
      ['Ще се свържете ли с работодателя ми?', 'Екипът ни разглежда предложенията поверително. Те никога не водят до автоматичен контакт с компанията.'],
      ['Купувате за екип?', 'Изберете HR опцията по-горе, за да поискате оферта. На този етап няма плащане.']
    ]
  }
};

const newKey = () => `cgl_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

function Mug({ className = '' }) {
  return <svg className={className} viewBox="0 0 220 205" aria-hidden="true">
    <path d="M151 44h19c43 0 43 68 0 68h-15" fill="none" stroke="currentColor" strokeWidth="13" />
    <path d="M29 32h133l-8 117c-1 18-13 30-30 30H66c-17 0-29-12-30-30z" fill="#eee7d6" stroke="currentColor" strokeWidth="4" />
    <path d="M30 33c3-10 128-10 132 0" fill="#d2c7af" stroke="currentColor" strokeWidth="4" />
    <path d="M49 159c17 9 75 13 94 0" fill="none" stroke="#cbc0aa" strokeWidth="2" />
    <text x="97" y="95" textAnchor="middle" fill="#77786a" fontFamily="Arial, sans-serif" fontSize="11" fontWeight="bold" letterSpacing="2">YOUR</text>
    <text x="97" y="111" textAnchor="middle" fill="#77786a" fontFamily="Arial, sans-serif" fontSize="11" fontWeight="bold" letterSpacing="2">LOGO</text>
    <text x="97" y="127" textAnchor="middle" fill="#77786a" fontFamily="Arial, sans-serif" fontSize="11" fontWeight="bold" letterSpacing="2">HERE</text>
  </svg>;
}

export default function CorporateWishlist() {
  const location = useLocation();
  const c = location.pathname.startsWith('/bg/') ? copy.bg : copy.en;
  const locale = c === copy.bg ? 'bg' : 'en';
  const [mode, setMode] = useState(() => new URLSearchParams(location.search).get('intent') === 'hr' ? 'hr' : 'nomination');
  const [key, setKey] = useState(newKey);
  const [values, setValues] = useState({ company: '', companyWebsite: '', hrContact: '', hrEmail: '', contactName: '', contactEmail: '', employeeCount: '', budget: '', message: '', consent: false, honeypot: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [personalMessages, setPersonalMessages] = useState({ en: copy.en.personalDefault, bg: copy.bg.personalDefault });
  const [copyStatus, setCopyStatus] = useState('');
  const giftUrl = `https://driftdwells.com${locale === 'bg' ? '/bg' : ''}/gift-vouchers`;
  const shareMessage = `${personalMessages[locale].trim()}\n\n${giftUrl}`;
  const copyGiftLink = async () => {
    try {
      await navigator.clipboard.writeText(giftUrl);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
  };
  const update = (name) => (event) => {
    if (error) { setKey(newKey()); setError(''); }
    setValues((old) => ({ ...old, [name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  };
  const selectMode = (next) => {
    setMode(next); setKey(newKey()); setError(''); setDone(false); setCopyStatus('');
    setValues((old) => ({ ...old, consent: false }));
  };
  const submit = async (event) => {
    event.preventDefault();
    if (busy || mode === 'personal') return;
    if (!values.company.trim() || (mode === 'hr' && (!values.contactName.trim() || !values.contactEmail.trim()))) { setError(c.requiredFields); return; }
    if (mode === 'nomination' && !values.hrEmail.trim() && !values.companyWebsite.trim()) { setError(c.contactRequired); return; }
    const email = mode === 'nomination' ? values.hrEmail.trim() : values.contactEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(c.contactInvalid); return; }
    let companyWebsite;
    try { companyWebsite = normalizeCompanyWebsite(values.companyWebsite); }
    catch { setError(c.contactInvalid); return; }
    setValues(old => ({ ...old, companyWebsite }));
    setBusy(true); setError('');
    try {
      const common = { company: values.company, companyWebsite, consent: values.consent, honeypot: values.honeypot };
      const details = mode === 'hr'
        ? { contactName: values.contactName, contactEmail: values.contactEmail, employeeCount: values.employeeCount, budget: values.budget, message: values.message }
        : { hrContact: values.hrContact, hrEmail: values.hrEmail };
      await api.post('/public/corporate-gift-leads', { ...common, ...details, type: mode, idempotencyKey: key, attribution: getAttributionPayload() });
      setDone(true);
    } catch {
      setError(c.error);
    } finally {
      setBusy(false);
    }
  };
  const field = (name, label, options = {}) => (
    <label className="wishlist-field">{label}
      {options.textarea
        ? <textarea value={values[name]} onChange={update(name)} maxLength={4000} rows="4" />
        : <input type={options.type || 'text'} value={values[name]} onChange={update(name)} required={options.required} maxLength={options.max || 200} placeholder={options.placeholder} inputMode={options.inputMode} autoComplete={options.autoComplete} autoCapitalize={options.autoCapitalize} spellCheck={options.spellCheck} />}
    </label>
  );
  return (
    <div className="wishlist" lang={c === copy.bg ? 'bg' : 'en'}>
      <Seo title={c.seo} description={c.description} canonicalPath="/wishlist" />
      <section className="wishlist-hero">
        <div className="wishlist-hero-copy">
          <div className="wishlist-eyebrow"><span aria-hidden="true">✳</span> {c.kicker}</div>
          <h1><span>{c.titleFirst}</span> <span>{c.titleMiddle}</span> <em>{c.titleLast}</em></h1>
          <p className="wishlist-hero-lead">{c.lead}</p>
          <a className="wishlist-button wishlist-button-dark" href="#wishlist-form">{c.action}<span aria-hidden="true">↗</span></a>
          <p className="wishlist-privacy">{c.privacy}</p>
        </div>
        <div className="wishlist-hero-art">
          <div className="wishlist-photo-frame">
            <img src="/media/home/wishlist-lux-cabin-christmas.jpeg" width="948" height="1659" alt={c.photoAlt} />
            <span className="wishlist-photo-caption">{c.photoCaption} <span aria-hidden="true">↗</span></span>
          </div>
          <div className="wishlist-hero-stamp" aria-hidden="true">{c.heroStamp}</div>
          <div className="wishlist-hero-mug" aria-hidden="true"><Mug /><span>NO. 014 / HR CLASSICS</span></div>
          <span className="wishlist-hero-note" aria-hidden="true">{c.heroNote} ↗</span>
        </div>
        <div className="wishlist-hero-footer"><span>{c.scroll}</span><span aria-hidden="true">↓</span><span>DRIFT &amp; DWELLS</span></div>
      </section>

      <section className="wishlist-merch">
        <div className="wishlist-wrap">
          <div className="wishlist-merch-heading"><div><div className="wishlist-eyebrow">{c.jokeKicker}</div><h2>{c.jokeTitle}</h2></div><p>{c.jokeLead}</p></div>
          <div className="wishlist-merch-lineup">
            <article><span className="wishlist-number">01 /</span><div className="wishlist-object wishlist-object-mug"><Mug /></div><h3>{c.mugLabel}</h3><p>{c.mugNote}</p></article>
            <article><span className="wishlist-number">02 /</span><div className="wishlist-object wishlist-object-pen" aria-hidden="true"><span>YOUR LOGO HERE</span></div><h3>{c.penLabel}</h3><p>{c.penNote}</p></article>
            <article><span className="wishlist-number">03 /</span><div className="wishlist-object wishlist-object-book" aria-hidden="true"><span>MEETING NOTES<br />&amp; BIG IDEAS</span></div><h3>{c.notebookLabel}</h3><p>{c.notebookNote}</p></article>
          </div>
        </div>
      </section>

      <section className="wishlist-reveal" id="possibilities">
        <div className="wishlist-reveal-top"><span>✳</span> {c.swap} <span>✳</span></div>
        <div className="wishlist-reveal-photo">
          <img src="/media/home/valley-aframes-close.jpg" width="1024" height="767" alt={c.revealAlt} loading="lazy" />
          <div className="wishlist-reveal-copy"><div className="wishlist-eyebrow">{c.revealKicker}</div><h2>{c.revealTitle}</h2><p>{c.revealLead}</p><a href="#wishlist-form">{c.action} <span aria-hidden="true">↗</span></a></div>
          <div className="wishlist-reveal-note" aria-hidden="true">{c.photoNote} ↙</div>
          <span className="wishlist-reveal-caption">{c.revealFoot}</span>
        </div>
      </section>

      <section className="wishlist-form-section" id="wishlist-form">
        <div className="wishlist-wrap wishlist-form-layout">
          <div className="wishlist-form-intro"><div className="wishlist-eyebrow">{c.formKicker}</div><h2>{mode === 'personal' ? c.personalTitle : c.formTitle}</h2><p>{mode === 'personal' ? c.personalLead : c.formLead}</p><div className="wishlist-envelope" aria-hidden="true"><span>{mode === 'personal' ? c.personalSubject : <>TO: HR<br />FROM: YOUR BIGGEST FAN</>}</span><i>✳</i></div></div>
          <div className="wishlist-form-box">
              <fieldset className="wishlist-modes" disabled={busy}><legend className="wishlist-sr-only">{c.modeLegend}</legend>
                <label><input type="radio" name="mode" checked={mode === 'nomination'} onChange={() => selectMode('nomination')} /><span>{c.nomination}</span></label>
                <label><input type="radio" name="mode" checked={mode === 'hr'} onChange={() => selectMode('hr')} /><span>{c.hr}</span></label>
                <label><input type="radio" name="mode" checked={mode === 'personal'} onChange={() => selectMode('personal')} /><span>{c.personal}</span></label>
              </fieldset>
            {mode === 'personal' ? <div className="wishlist-personal">
              <p className="wishlist-form-context">{c.personalIntro}</p>
              <label className="wishlist-field">{c.personalMessage}
                <textarea rows="6" maxLength={1500} value={personalMessages[locale]} onChange={event => setPersonalMessages(old => ({ ...old, [locale]: event.target.value }))} />
              </label>
              <label className="wishlist-field">{c.giftLink}<input type="text" readOnly value={giftUrl} onFocus={event => event.target.select()} /></label>
              <div className="wishlist-share-actions">
                <a className="wishlist-button wishlist-button-dark" href={`https://wa.me/?text=${encodeURIComponent(shareMessage)}`} target="_blank" rel="noopener noreferrer">{c.whatsapp}</a>
                <a className="wishlist-button wishlist-button-dark" href={`mailto:?subject=${encodeURIComponent(c.personalSubject)}&body=${encodeURIComponent(shareMessage)}`}>{c.emailShare}</a>
                <button className="wishlist-button wishlist-button-dark" type="button" onClick={copyGiftLink}>{c.copyLink}</button>
              </div>
              {copyStatus && <p className={copyStatus === 'error' ? 'wishlist-error' : 'wishlist-form-context'} role={copyStatus === 'error' ? 'alert' : 'status'}>{copyStatus === 'error' ? c.copyError : c.copied}</p>}
              <p className="wishlist-form-context">{c.personalPrivacy}</p>
            </div> : done ? <div role="status" className="wishlist-confirmation"><div className="wishlist-confirmation-mark" aria-hidden="true">✳</div><h3>{mode === 'hr' ? c.hrThanks : c.thanks}</h3><p>{mode === 'hr' ? c.hrDone : c.nominationDone}</p><div className="wishlist-handwritten">{c.successNote} ↗</div></div> : <>
              <p className="wishlist-form-context">{mode === 'hr' ? c.hrIntro : c.nominationIntro}</p>
              <form onSubmit={submit}><fieldset className="wishlist-fields" disabled={busy}>
                {field('company', c.company, { required: true })}
                {mode === 'nomination' && <p className="wishlist-form-context">{c.contactRequired}</p>}
                {field('companyWebsite', mode === 'nomination' ? c.website : c.websiteOptional, { inputMode: 'url', autoComplete: 'url', autoCapitalize: 'none', spellCheck: false, max: 500, placeholder: c.websiteHint })}
                {mode === 'nomination' ? <>{field('hrEmail', c.hrEmail, { type: 'email', max: 320 })}{field('hrContact', c.hrContact)}</> : <>
                  {field('contactName', c.contactName, { required: true, max: 120 })}
                  {field('contactEmail', c.contactEmail, { required: true, type: 'email', max: 320 })}
                  {field('employeeCount', c.employeeCount, { max: 80 })}
                  {field('budget', c.budget, { max: 120 })}
                  {field('message', c.message, { textarea: true })}
                </>}
                <div className="wishlist-honeypot" aria-hidden="true"><label>Leave blank<input tabIndex="-1" autoComplete="off" value={values.honeypot} onChange={update('honeypot')} /></label></div>
                <label className="wishlist-consent"><input type="checkbox" required checked={values.consent} onChange={update('consent')} />{mode === 'hr' ? c.consentHr : c.consentNomination}</label>
                {error && <p className="wishlist-error" role="alert">{error}</p>}
                <button className="wishlist-button wishlist-button-dark wishlist-submit" type="submit" disabled={busy}>{busy ? c.sending : mode === 'hr' ? c.sendHr : c.sendNomination}<span aria-hidden="true">↗</span></button>
              </fieldset></form>
            </>}
          </div>
        </div>
      </section>
      <section className="wishlist-faq"><div className="wishlist-wrap"><div className="wishlist-eyebrow">{c.faq}</div><div>{c.questions.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></div></section>
    </div>
  );
}
