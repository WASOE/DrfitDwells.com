import { useLocation } from 'react-router-dom';

const Footer = () => {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <footer
      className={`relative text-white overflow-hidden z-10 ${isHome ? 'md:-mt-96 -mt-16' : 'mt-0'}`}
      style={{
        backgroundColor: '#000',
        backgroundImage: "url('/uploads/Content%20website/drift-dwells-bulgaria-bucephalus-suite.avif')",
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      {/* Layer 1: global tint */}
      <div className="absolute inset-0 bg-black/20" />
      {/* Layer 2: vignette that darkens behind cards and to browser edge */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent" />

      <div className={`relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${isHome ? 'pt-[32rem]' : 'pt-16'} pb-16 md:pb-24 space-y-16`}>
        {/* Living Notes / Guestbook moved inside footer */}
        <div className="max-w-2xl mx-auto text-center space-y-4 drop-shadow-lg">
          <div className="w-24 h-[1px] bg-white/40 mx-auto mb-4" />
          <p className="text-xs uppercase tracking-[0.4em] text-white/70 mb-1">Guestbook</p>
          <h2 className="font-['Playfair_Display'] text-4xl md:text-5xl text-white drop-shadow-md">
            Living Notes
          </h2>
          <p className="font-['Merriweather'] text-base md:text-lg text-white/80 italic">
            Ink that keeps moving long after guests depart.
          </p>
          <div className="mt-8 space-y-6 md:space-y-8 text-left md:text-center">
            <p className="font-['Caveat'] text-2xl md:text-3xl text-white/90 leading-snug">
              Left the phones in the drawer and heard the creek compose a lullaby for us.
              <span className="block mt-2 text-white/70 text-xl">— Mira &amp; Theo</span>
            </p>
            <p className="font-['Caveat'] text-2xl md:text-3xl text-white/90 leading-snug">
              We brewed pine needle tea at dawn. The steam looked like soft handwriting.
              <span className="block mt-2 text-white/70 text-xl">— Daniela</span>
            </p>
            <p className="font-['Caveat'] text-2xl md:text-3xl text-white/90 leading-snug">
              The journal we found on the shelf had pressed ferns from guests we will never meet.
              <span className="block mt-2 text-white/70 text-xl">— Petra &amp; Ivo</span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 pt-8 md:pt-10">
          <div>
            <h3 className="text-sm font-bold tracking-widest uppercase mb-4">Our Promise</h3>
            <p className="text-gray-200 text-sm leading-relaxed">
              Eco-retreat cabins in the heart of Bulgaria’s pristine wilderness. Experience sustainable luxury framed by handcrafted storytelling.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-bold tracking-widest uppercase mb-4">Quick Links</h3>
            <ul className="space-y-3 text-sm font-medium text-white/60">
              <li><a href="/" className="hover:text-white transition-colors">Home</a></li>
              <li><a href="/search" className="hover:text-white transition-colors">Search Cabins</a></li>
              <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-bold tracking-widest uppercase mb-4">Contact</h3>
            <div className="space-y-3 text-sm text-white/60">
              <p>📧 info@driftdwells.com</p>
              <p>📞 +359 88 123 4567</p>
              <p>📍 Rhodope Mountains, Bulgaria</p>
            </div>
          </div>
        </div>

        <div className="border-t border-white/20 pt-6 text-sm text-gray-300 flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
          <p>© 2024 Drift & Dwells. All rights reserved.</p>
          <div className="flex space-x-8">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
