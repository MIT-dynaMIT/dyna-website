import React from 'react';

interface FAQItemProps {
  question: string;
  answer: string;
  isOpen: boolean;
  onClick: () => void;
}

const FAQItem: React.FC<FAQItemProps> = ({ question, answer, isOpen, onClick }) => {
  return (
    <div className="w-full max-w-xl rounded-lg bg-white shadow-sm transition-shadow duration-300 hover:shadow-xl">
      <button
        className="w-full bg-white px-6 py-4 text-left hover:bg-gray-50 focus:outline-none"
        onClick={onClick}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-dark">
            {question}
          </h3>
          <span className="ml-6 flex-shrink-0">
            {isOpen ? (
              <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </span>
        </div>
        {isOpen && (
          <div className="mt-4">
            <p className="text-dark">
              {answer}
            </p>
          </div>
        )}
      </button>
    </div>
  );
};

export default FAQItem;
