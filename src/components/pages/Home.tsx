import ContentBox from "../modules/ContentBox";
import FAQItem from "../modules/FAQItem";
import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { faqs } from "../../utils";

const Home = () => {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);

  const location = useLocation();

  useEffect(() => {
    const hash = location.hash;
    if (hash) {
      requestAnimationFrame(() => {
        const targetElement = document.getElementById(hash.replace("#", ""));
        if (targetElement) {
          targetElement.scrollIntoView({ block: "start" });
        }
      });
    }
  }, [location.hash]);

  return (
    <>
      {/* Hero Section */}
      <div className="text-center">
        <h1 className="mb-6 font-display text-5xl font-extrabold tracking-tight sm:text-6xl md:text-7xl">
          <span className="text-primary">dyna</span>
          <span className="text-secondary">MIT</span>
        </h1>
        <p className="mx-auto mb-5 max-w-3xl text-xl font-semibold text-dark sm:text-2xl">
          Igniting the STEM interests of the next generation.
        </p>
        <p className="mx-auto max-w-2xl text-lg leading-relaxed text-dark/75">
          A free summer program at MIT where Massachusetts middle school
          students explore their passion for science and engineering through
          hands-on activities.
        </p>
      </div>

      {/* Feature Grid */}
      <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-2">
        <ContentBox title="Our Mission" image="/home_images/our_mission.jpg">
          <p className="mb-4">
            Our mission is to provide students from low-income families with an
            opportunity to explore and discover their interests in science and
            engineering. Through hands-on activities and close mentorship from
            MIT students, we aim to inspire the next generation of scientists
            and engineers.
          </p>
        </ContentBox>

        <ContentBox
          title="Students"
          image="/home_images/students.jpg"
          buttonText="Apply as a Student"
          buttonLink="/apply/#students"
        >
          <p className="mb-4">
            Rising 6th-9th grade students are eligible for this year's program.
          </p>
          <p>
            We particularly encourage applications from students who might not
            otherwise have access to STEM enrichment programs.
          </p>
        </ContentBox>

        <ContentBox
          title="Mentors: MIT Students"
          image="/home_images/mentors.jpg"
          buttonText="Apply as a Mentor"
          buttonLink="/apply/#mentors"
        >
          <p className="mb-4">
            Throughout each week, MIT undergraduate and graduate students serve
            as mentors to instruct the students and guide them through various
            experiments and activities.
          </p>
          <p>
            Our mentors are passionate about sharing their love for science and
            engineering with the next generation.
          </p>
        </ContentBox>

        <ContentBox
          title="Executive Board"
          image="/home_images/board.jpg"
          buttonText="Meet Our Board"
          buttonLink="/board"
        >
          <p className="mb-4">
            dynaMIT is entirely student-run. Throughout the school year, MIT
            undergrads come up with experiments, develop curriculum, and
            organize logistics to ensure that each summer is better than the
            last.
          </p>
          <p>Meet our dedicated board members who make dynaMIT possible!</p>
        </ContentBox>
      </div>

      {/* Crowdfunding Callout */}
      <div className="mt-16">
        <a
          href="https://crowdfund.mit.edu/story/dynaMIT-S26"
          target="_blank"
          rel="noopener noreferrer"
          className="group block overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-secondary p-8 shadow-lg transition-transform duration-200 hover:scale-[1.01] hover:shadow-xl sm:p-12"
        >
          <div className="flex flex-col items-center gap-6 text-center md:flex-row md:text-left">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-white/20 md:h-20 md:w-20">
              <svg
                className="h-8 w-8 text-white md:h-10 md:w-10"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-secondary-light">
                Support dynaMIT
              </p>
              <h2 className="mb-2 text-2xl font-bold text-white sm:text-3xl">
                Help us power summer 2026
              </h2>
              <p className="text-white/90">
                Every contribution helps us keep dynaMIT free for middle
                schoolers — funding lab materials, meals, and transportation
                for students across Massachusetts.
              </p>
            </div>
            <div className="flex-shrink-0">
              <span className="inline-flex items-center rounded-full bg-white px-6 py-3 font-semibold text-primary shadow-md transition-colors duration-200 group-hover:bg-secondary-light">
                Donate
                <svg
                  className="ml-2 h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  />
                </svg>
              </span>
            </div>
          </div>
        </a>
      </div>

      {/* FAQ Section */}
      <h2 className="mt-20 mb-10 text-center font-display text-3xl font-bold sm:text-4xl" id="faq">
        Frequently Asked Questions
      </h2>
      <div className="space-y-3">
        {faqs.map((faq, index) => (
          <div key={index} className="flex justify-center">
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
