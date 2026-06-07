import { useEffect, useState } from 'react';

const BuildHeroPhoto = ({ imageUrl, alt = 'Your cabin', fillContainer = false }) => {
  const [displayUrl, setDisplayUrl] = useState(imageUrl);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    if (imageUrl === displayUrl) return undefined;

    setOpacity(0.3);
    const timer = setTimeout(() => {
      setDisplayUrl(imageUrl);
      setOpacity(1);
    }, 280);

    return () => clearTimeout(timer);
  }, [imageUrl, displayUrl]);

  const containerClass = fillContainer
    ? 'h-full w-full overflow-hidden'
    : 'sticky top-[var(--header-offset,68px)] h-[50vw] min-h-[240px] overflow-hidden lg:h-[calc(100vh-var(--header-offset,68px))] lg:min-h-0';

  return (
    <div className={containerClass}>
      <img
        src={displayUrl}
        alt={alt}
        className="block h-full w-full object-cover transition-opacity duration-500"
        style={{ opacity }}
      />
    </div>
  );
};

export default BuildHeroPhoto;
