import React from 'react';
import { Link } from 'react-router-dom';

interface ContentBoxProps {
  title: string;
  children: React.ReactNode;
  buttonText?: string;
  buttonLink?: string;
}

const ContentBox: React.FC<ContentBoxProps> = ({ title, children, buttonText, buttonLink }) => {
  return (
    <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow duration-300">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">{title}</h2>
      <div className="text-gray-600">
        {children}
      </div>
      {buttonText && buttonLink && (
        <div className="mt-6">
          <Link
            to={buttonLink}
            className="inline-block bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors duration-200"
          >
            {buttonText}
          </Link>
        </div>
      )}
    </div>
  );
};

export default ContentBox;
