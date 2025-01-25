import React, { useState } from 'react';
import FAQItem from '../modules/FAQItem';

interface FAQItem {
  question: string;
  answer: string;
}

const faqs: FAQItem[] = [
  {
    question: "When is the DynaMIT Summer 2025 program?",
    answer: "Week 1 will run from August 11th to August 15th, hosting rising 6th/7th graders. Week 2 will run from August 18th to August 22nd, hosting rising 8th/9th graders. Our program is fully in-person on MIT campus!"
  },
  {
    question: "Where is dynaMIT located?",
    answer: "dynaMIT is located on MIT campus and the entire duration of the program happens in MIT."
  },
  {
    question: "Will dynaMIT provide housing or transportation?",
    answer: "No, dynaMIT is not a sleepaway camp so we rely on parents to provide housing and transportation to and from camp. Ideally students will be coming from the Boston area (or somewhere close), so housing should not be an issue."
  },
  {
    question: "Is dynaMIT free?",
    answer: "Yes, dynaMIT is completely free of charge to the students, though individuals are more than welcome to donate to our cause in order to help us keep the camp free. However, donations are not required by any means."
  },
  {
    question: "Who are the instructors at dynaMIT? How can I volunteer?",
    answer: "All of our mentors are current MIT undergraduate students who volunteer a week of their time in the summer to teach at camp. MIT students interested in applying to be a mentor should apply now!"
  },
  {
    question: "How are students selected for the program?",
    answer: "We do our best to accept students based on need as we hope to make STEM education more accessible for the underserved."
  }
];

const FAQ = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-4xl font-bold text-center text-gray-900 mb-12">
          Frequently Asked Questions
        </h1>
        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className="bg-white rounded-lg shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1"
            >
              <FAQItem
                question={faq.question}
                answer={faq.answer}
                isOpen={openIndex === index}
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FAQ;
