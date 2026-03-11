const StickyBookingBar = ({
  label,
  subLabel,
  buttonLabel,
  onButtonClick,
  buttonDisabled = false,
  className = '',
  children
}) => {
  return (
    <div
      className={`fixed bottom-0 left-0 w-full z-50 bg-white border-t border-stone-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] px-4 py-3.5 md:py-3 flex items-center justify-between gap-3 ${className || ''}`}
      style={{ paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))' }}
    >
      <div className="text-sm md:text-sm flex-1 min-w-0">
        {children || (
          <>
            {label && (
              <div className="font-semibold md:font-semibold text-gray-900 tabular-nums truncate text-base md:text-sm">
                {label}
              </div>
            )}
            {subLabel && (
              <div className="text-gray-500 text-xs md:text-xs mt-0.5 truncate">
                {subLabel}
              </div>
            )}
          </>
        )}
      </div>
      {buttonLabel && (
        <button
          type="button"
          onClick={onButtonClick}
          disabled={buttonDisabled}
          className={`flex-shrink-0 px-5 md:px-4 py-3 md:py-2.5 rounded-xl bg-[#81887A] text-white text-sm md:text-sm font-semibold shadow-sm transition-all active:scale-[0.97] touch-manipulation min-h-[44px] md:min-h-0 ${
            buttonDisabled ? 'opacity-50 cursor-not-allowed active:scale-100' : 'hover:opacity-95 active:bg-[#6B6B6B]'
          }`}
        >
          {buttonLabel}
        </button>
      )}
    </div>
  );
};

export default StickyBookingBar;

























