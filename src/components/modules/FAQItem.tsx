import React from 'react';

interface FAQItemProps {
  question: string;
  answer: string;
  isOpen: boolean;
  onClick: () => void;
}

const FAQItem: React.FC<FAQItemProps> = ({ question, answer, isOpen, onClick }) => {
  return (
    <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white ring-1 ring-dark/5 shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-6 px-6 py-4 text-left transition-colors duration-200 hover:bg-dark/[0.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        onClick={onClick}
        aria-expanded={isOpen}
      >
        <h3 className="text-base font-semibold text-dark sm:text-lg">
          {question}
        </h3>
        <svg
          className={`h-5 w-5 flex-shrink-0 text-dark/50 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`grid transition-all duration-200 ease-in-out ${
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <p className="px-6 pb-5 text-left leading-relaxed text-dark/80">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
};

export default FAQItem;
