const WifiIcon = ({ className = "w-10 h-10" }) => {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Signal/Wave bars - Starlink style */}
      <rect x="3" y="18" width="3" height="4" rx="1" fill="currentColor" />
      <rect x="8" y="14" width="3" height="8" rx="1" fill="currentColor" />
      <rect x="13" y="10" width="3" height="12" rx="1" fill="currentColor" />
      <rect x="18" y="6" width="3" height="16" rx="1" fill="currentColor" />
    </svg>
  );
};

export default WifiIcon;

