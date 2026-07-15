/**
 * White booking card chrome for split video heroes (desktop right column).
 * Slot scroll constraints live on the parent `.split-hero-card-slot` wrapper.
 */
const HeroBookingCardShell = ({ children, className = '', ...rest }) => (
  <div
    className={`hero-booking-card-shell w-full max-w-md rounded-2xl border border-gray-200/80 bg-white shadow-lg p-5 md:p-6 ${className}`.trim()}
    {...rest}
  >
    {children}
  </div>
);

export default HeroBookingCardShell;
