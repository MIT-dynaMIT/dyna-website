import React from 'react';

interface FAQItemProps {
  question: string;
  answer: string;
  isOpen: boolean;
  onClick: () => void;
}

const FAQItem: React.FC<FAQItemProps> = ({ question, answer, isOpen, onClick }) => {
  return (
    <div className="bg-white rounded-lg shadow-sm hover:bg-gray-50 transition-colors duration-200">
      <button
        className="w-full px-6 py-4 text-left focus:outline-none bg-white hover:bg-gray-50"
        onClick={onClick}
      >
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-700">
            {question}
          </h3>
          <span className="ml-6 flex-shrink-0">
            {isOpen ? (
              <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </span>
        </div>
        {isOpen && (
          <div className="mt-4">
            <p className="text-gray-600">
              {answer}
            </p>
          </div>
        )}
      </button>
    </div>
  );
};

export default FAQItem;
