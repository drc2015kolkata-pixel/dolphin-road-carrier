import React from 'react';

interface DrcTriangleLogoProps {
  className?: string;
  alt?: string;
}

export const DrcTriangleLogo: React.FC<DrcTriangleLogoProps> = ({
  className = 'w-12 h-12',
  alt = 'Dolphin Road Carriers DRC Official Logo',
}) => {
  return (
    <img
      src="/drc-triangle-logo.svg"
      alt={alt}
      className={`object-contain select-none ${className}`}
    />
  );
};
