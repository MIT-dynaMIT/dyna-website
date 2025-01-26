import React from 'react';
import { Link } from 'react-router-dom';

interface ContentBoxProps {
  title: string;
  children: React.ReactNode;
  buttonText?: string;
  buttonLink?: string;
  image?: string; // New optional image prop
}

const ContentBox: React.FC<ContentBoxProps> = ({ title, children, buttonText, buttonLink, image }) => {
  return (
    <div className="rounded-lg bg-white p-6 shadow-lg transition-shadow duration-300 hover:shadow-xl">
      {image && (
        <img
          src={image}
          alt={title}
          className="h-75 mb-4 w-full object-cover" // CSS for constant size and aspect ratio
        />
      )}
      <h2 className="mb-4 text-2xl font-bold text-dark">{title}</h2>
      <div className="text-dark">
        {children}
      </div>
      {buttonText && buttonLink && (
        <div className="mt-6">
          <Link
            to={buttonLink}
            className="inline-block rounded-md bg-primary px-4 py-2 text-white transition-colors duration-200 hover:bg-primary"
          >
            {buttonText}
          </Link>
        </div>
      )}
    </div>
  );
};

export default ContentBox;