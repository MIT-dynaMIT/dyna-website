import { formatDateToReadableString,week1Start, week1End, week2Start, week2End } from '../../utils';
import ContentBox from '../modules/ContentBox';
import FAQItem from '../modules/FAQItem';
import React from 'react';

interface FAQItemObj {
  question: string;
  answer: string;
}

const faqs: FAQItemObj[] = [
  {
    question: `When is the dynaMIT Summer ${week1Start.getFullYear()} program?`,
    answer: `Week 1 will run from ${formatDateToReadableString(week1Start)} to ${formatDateToReadableString(week1End)}, hosting rising 6th/7th graders. Week 2 will run from ${formatDateToReadableString(week2Start)} to ${formatDateToReadableString(week2End)}, hosting rising 8th/9th graders. Our program is fully in-person on MIT campus!`  
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

const Home = () => {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);

  return (
    <>
      {/* Hero Section */}
      <div className="text-center">
        <h1 className="mb-6 text-4xl font-bold sm:text-5xl md:text-6xl">
          <span className="text-primary">dyna</span><span className="text-secondary">MIT</span>
        </h1>
        <p className="mx-auto mb-6 max-w-3xl text-center text-xl font-bold">
          Igniting the STEM Interests of the Next Generation
        </p>
        <p className="mx-auto max-w-3xl text-center text-xl">
          A free summer program at MIT where middle school students can explore their passion for science and engineering through hands-on activities.
        </p>
      </div>

      {/* Feature Grid */}
      <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-2">
        <ContentBox 
          title="Our Mission"
          image="/home_images/our_mission.jpg"
        >
          <p className="mb-4">
            Our mission is to provide students from low-income families with an opportunity to explore and
            discover their interests in science and engineering. Through hands-on activities and close
            mentorship from MIT students, we aim to inspire the next generation of scientists and engineers.
          </p>
        </ContentBox>

        <ContentBox 
          title="Students"
          image="/home_images/students.jpg"
          buttonText="Apply as a Student"
          buttonLink="/apply"
        >
          <p className="mb-4">
            Rising 6th-9th grade students are eligible for this year's program.
          </p>
          <p>
            We particularly encourage applications from students who might not otherwise have access to STEM
            enrichment programs.
          </p>
        </ContentBox>

        <ContentBox 
          title="Mentors: MIT Students"
          image="/home_images/mentors.jpg"
          buttonText="Apply as a Mentor"
          buttonLink="/apply"
        >
          <p className="mb-4">
            Throughout each week, MIT undergraduate and graduate students serve as mentors to instruct the
            students and guide them through various experiments and activities.
          </p>
          <p>
            Our mentors are passionate about sharing their love for science and engineering with the next
            generation.
          </p>
        </ContentBox>

        <ContentBox 
          title="Executive Board"
          image="/home_images/board.jpg"
          buttonText="Meet Our Board"
          buttonLink="/board"
        >
          <p className="mb-4">
            dynaMIT is entirely student-run. Throughout the school year, MIT undergrads come up with experiments,
            develop curriculum, and organize logistics to ensure that each summer is better than the last.
          </p>
          <p>
            Meet our dedicated board members who make dynaMIT possible!
          </p>
        </ContentBox>
      </div>

      {/* FAQ Section */}
      <h1 className="p-12 text-center text-4xl font-bold" id="faq">
        Frequently Asked Questions
      </h1>
      <div className="space-y-4">
        {faqs.map((faq, index) => (
          <div
            key={index}
            className="flex justify-center"
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
    </>
  );
};

export default Home;
