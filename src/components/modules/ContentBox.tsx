import React from 'react';
import { Link } from 'react-router-dom';

interface ContentBoxProps {
  title: string;
  children: React.ReactNode;
  buttonText?: string;
  buttonLink?: string;
  image?: string;
}

const ContentBox: React.FC<ContentBoxProps> = ({ title, children, buttonText, buttonLink, image }) => {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-dark/5 shadow-card">
      {image && (
        <div className="aspect-[16/10] w-full overflow-hidden">
          <img
            src={image}
            alt={title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col p-6 sm:p-7">
        <h2 className="mb-3 font-display text-2xl font-bold text-dark">{title}</h2>
        <div className="flex-1 space-y-3 text-left text-dark/80 leading-relaxed">
          {children}
        </div>
        {buttonText && buttonLink && (
          <div className="mt-6">
            <Link
              to={buttonLink}
              className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {buttonText}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default ContentBox;
