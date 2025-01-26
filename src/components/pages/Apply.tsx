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
          <div className="rounded-lg bg-white p-6 shadow-lg transition-shadow duration-300 hover:shadow-xl">
            <div className="p-8">
              <h2 className="mb-4 text-2xl font-bold text-dark">Students</h2>
              <div className="space-y-4">
                <div className="rounded-lg bg-light p-4">
                  <p className="font-semibold text-dark">
                    Applications are open until March 10th!
                  </p>
                </div>
                <p className="text-dark">
                  We accept students who will be entering 6th, 7th, 8th, or 9th grades in the
                  2025-2026 School Year.
                </p>
                <a
                  href="https://forms.gle/Xd2DrjGATbq175NC6"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:bg-primary-700 inline-block rounded-lg bg-primary px-6 py-3 text-white transition-colors duration-200"
                >
                  Apply to dynaMIT!
                </a>
              </div>
            </div>
          </div>

          {/* Mentors Card */}
          <div className="rounded-lg bg-white p-6 shadow-lg transition-shadow duration-300 hover:shadow-xl">
            <div className="p-8">
              <h2 className="mb-4 text-2xl font-bold text-dark">Mentors</h2>
              <div className="space-y-4">
                <div className="rounded-lg bg-light p-4">
                  <p className="font-semibold text-dark">
                    Applications for dynaMIT mentors are open!
                  </p>
                </div>
                <p className="text-dark">
                  Join us as a mentor and help inspire the next generation of STEM enthusiasts.
                  All MIT undergraduate students are welcome to apply!
                </p>
                <a
                  href="https://forms.gle/9xV1USV2REbJL5716"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-lg bg-primary px-6 py-3 text-white transition-colors duration-200 hover:bg-primary"
                >
                  Teach at dynaMIT!
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Information */}
        <div className="mt-16 rounded-lg bg-white p-6 shadow-lg transition-shadow duration-300 hover:shadow-xl">
          <h2 className="mb-4 text-2xl font-bold text-dark">Important Dates</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-lg font-semibold text-dark">Week 1: Rising 6th/7th Graders</h3>
              <p className="text-dark">August 11th to August 15th, 2025</p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-dark">Week 2: Rising 8th/9th Graders</h3>
              <p className="text-dark">August 18th to August 22nd, 2025</p>
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
