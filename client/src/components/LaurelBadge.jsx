import React from 'react';

const LaurelBadge = () => {
  return (
    <div className="flex items-center justify-between bg-white border border-stone-200 rounded-2xl px-6 py-4 shadow-sm w-full max-w-sm">
      {/* LEFT SIDE: Icon + Text */}
      <div className="flex items-center gap-4">
        {/* The Hardcoded Laurel SVG - DO NOT REPLACE */}
        <svg 
          viewBox="0 0 32 32" 
          xmlns="http://www.w3.org/2000/svg" 
          aria-hidden="true" 
          role="presentation" 
          focusable="false" 
          style={{ display: 'block', height: '40px', width: '40px', fill: '#1c1917' }}
        >
          <path d="M16 .798l.555.37C20.398 3.73 24.208 5.912 25.524 16.362c.642 5.095-2.785 8.163-5.523 10.374l-.963.713-.235 1.21c-.42 2.164-1.322 2.54-2.803 2.54-1.48 0-2.383-.376-2.803-2.54l-.235-1.21-.963-.714C9.24 24.524 5.813 21.457 6.456 16.362 7.772 5.912 11.582 3.73 15.425 1.168l.575-.37zm4.333 19.576l.75-1.306a19.722 19.722 0 0 1 2.378-3.033l.23.185c.15.12.302.24.455.362-.835 1.35-1.95 2.532-3.21 3.492l-.603.3zM21.2 26.3l.537 1.402c.165.43.327.864.485 1.298-1.554.49-3.125.86-4.71 1.107l-.15-1.492a18.397 18.397 0 0 1 3.838-.315zM7.667 20.374l-.602-.3c-1.26-.96-2.376-2.142-3.21-3.492.152-.12.305-.24.455-.36l.23-.186c.69 1.11 1.5 2.128 2.377 3.032l.75 1.306zM10.8 26.3a18.397 18.397 0 0 1 3.838.315l-.15 1.492c-1.585-.247-3.156-.617-4.71-1.107.158-.434.32-.868.485-1.298l.537-1.402zM15.207 4.212c-2.392 1.62-5.068 3.25-6.027 10.966-.412 3.32.96 5.632 4.137 8.196l1.378 1.02 1.306 6.723c.523.005 1.037-.01 1.543-.045l.233-1.201.222-1.143-1.118-.902c-3.153-2.545-4.52-4.832-4.113-8.077.93-7.48 3.526-9.063 5.867-10.64l.582-.392-4.01-4.505zm5.586 0l-4.01 4.505.582.392c2.341 1.577 4.937 3.16 5.867 10.64.407 3.245-.96 5.532-4.113 8.077l-1.118.902.222 1.143.233 1.2c.506.036 1.02.05 1.543.046l1.306-6.723 1.378-1.02c3.177-2.564 4.55-4.876 4.137-8.196-.96-7.716-3.635-9.346-6.027-10.966z"></path>
        </svg>
        
        <div className="flex flex-col">
          <span className="text-sm font-bold text-stone-900 leading-none">
            Guest favorite
          </span>
          <span className="text-xs text-stone-500 leading-tight mt-1">
            One of the most loved homes on Airbnb
          </span>
        </div>
      </div>

      {/* RIGHT SIDE: Score */}
      <div className="flex flex-col items-center border-l border-stone-200 pl-6 ml-4">
        <span className="text-2xl font-bold text-stone-900 leading-none">
          4.95
        </span>
        <div className="flex gap-0.5 mt-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <svg key={star} viewBox="0 0 32 32" className="w-3 h-3 fill-stone-900" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="presentation" focusable="false"><path d="M15.094 1.579l-4.124 8.885-9.86 1.27a1 1 0 0 0-.54 1.736l7.293 6.815-1.991 9.692a1 1 0 0 0 1.488 1.081L16 26.223l8.64 4.834a1 1 0 0 0 1.488-1.08l-1.991-9.693 7.293-6.815a1 1 0 0 0-.54-1.736l-9.86-1.27-4.124-8.885a1 1 0 0 0-1.812 0z"></path></svg>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LaurelBadge;
