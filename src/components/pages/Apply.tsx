import AppCard from '../modules/AppCard.tsx';
import { 
  formatDateToReadableString, 
  formatDateToStringWithYear, 
  studentDeadline, 
  mentorDeadline, 
  week1Start, 
  week1End, 
  week2Start, 
  week2End 
} from '../../utils.ts';

const Apply = () => {

  return (
    <>
      <h1 className="mb-12 text-center text-4xl font-bold">Join dynaMIT!</h1>
      <div className="">
        {/* Header */}
        <div className="mb-16 text-center">
          <p className="mx-auto mt-4 max-w-3xl text-xl text-dark">
            Whether you are a parent looking to enroll your kids in our program
            or an MIT student who wants to be a mentor for the summer, we'd love for
            you to join us. All applications for camp and for mentors open in the spring.
            If you want to join our internal team, board applications typically open in the fall!
          </p>
        </div>

        {/* Application Cards */}
        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-2">
          {/* Students Card */}
          <AppCard 
            title="Students" 
            deadline={studentDeadline} 
            link="https://forms.gle/Xd2DrjGATbq175NC6" 
            description={`We accept students who will be entering 6th, 7th, 8th, or 9th grades in the
                  ${week1Start.getFullYear()}-${week1Start.getFullYear() + 1} School Year.`}
            linkText="Apply to dynaMIT!"
          />
          {/* Mentors Card */}
          <AppCard 
            title="Mentors" 
            deadline={mentorDeadline} 
            link="https://forms.gle/1X1JXJGZzVY2G6bC9" 
            description={`Join us as a mentor and help inspire the next generation of STEM enthusiasts.
                  All MIT undergraduate students are welcome to apply!`}
            linkText="Apply to be a mentor!"
          />
        </div>

        {/* Additional Information */}
        <div className="mt-16 rounded-lg bg-white p-6 shadow-lg">
          <h2 className="mb-4 text-2xl font-bold text-dark">Important Dates</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-lg font-semibold text-dark">Week 1: Rising 6th/7th Graders</h3>
              <p className="text-dark">{formatDateToReadableString(week1Start)} to {formatDateToStringWithYear(week1End)}</p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-dark">Week 2: Rising 8th/9th Graders</h3>
              <p className="text-dark">{formatDateToReadableString(week2Start)} to {formatDateToStringWithYear(week2End)}</p>
            </div>
          </div>
          <div className="mt-6">
            <p className="text-dark">
              All sessions are held in-person on the MIT campus. For any questions about the application process,
              please check our <a href="/#faq" className="text-primary hover:underline">FAQ</a> or contact us directly.
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default Apply;
