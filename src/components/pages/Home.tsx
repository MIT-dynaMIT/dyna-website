import ContentBox from '../modules/ContentBox';

const Home = () => {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl md:text-6xl">
            MIT <span className="text-blue-600">dynaMIT</span>
          </h1>
          <p className="text-xl text-center max-w-3xl mx-auto">
            A free summer program at MIT where middle school students can explore their passion for science and engineering through hands-on activities.
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Feature Grid */}
        <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-2">
          <ContentBox 
            title="Our Mission"
          >
            <p className="mb-4">
              Our mission is to provide students from low-income families with an opportunity to explore and
              discover their interests in science and engineering. Through hands-on activities and close
              mentorship from MIT students, we aim to inspire the next generation of scientists and engineers.
            </p>
          </ContentBox>

          <ContentBox 
            title="Students"
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
            title="Board"
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
      </div>
    </div>
  );
};

export default Home;
