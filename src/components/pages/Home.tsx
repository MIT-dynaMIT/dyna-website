import ContentBox from '../modules/ContentBox';
import FAQItem from '../modules/FAQItem';
import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { faqs } from '../../utils';

const Home = () => {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);

  const location = useLocation();

  useEffect(() => {
    const hash = location.hash;
    if (hash) {
      setTimeout(() => {
        const targetElement = document.getElementById(hash.replace("#", ""));
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 200);
    }
  }, [location.hash]);

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
