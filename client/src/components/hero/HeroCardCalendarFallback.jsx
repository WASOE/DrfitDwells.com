import HeroBookingCardShell from './HeroBookingCardShell';

const HeroCardCalendarFallback = () => (
  <HeroBookingCardShell aria-hidden="true">
    <div className="animate-pulse space-y-4">
      <div className="h-4 bg-gray-200 rounded w-2/5" />
      <div className="h-6 bg-gray-200 rounded w-3/5" />
      <div className="min-h-[320px] grid grid-cols-7 gap-2 content-start">
        {Array.from({ length: 35 }, (_, index) => (
          <div key={index} className="h-9 bg-gray-100 rounded-md" />
        ))}
      </div>
    </div>
  </HeroBookingCardShell>
);

export default HeroCardCalendarFallback;
