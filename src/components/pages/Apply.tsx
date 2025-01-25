const Apply = () => {
  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900">Be Part of DynaMIT</h1>
          <p className="mt-4 text-xl text-gray-600 max-w-3xl mx-auto">
            Whether you are a parent looking to enroll your kids in our program
            or an MIT student who wants to be a mentor for the summer, we'd love for
            you to join us. All applications for camp and for mentors open in the spring.
            If you want to join our internal team, board applications typically open in the fall!
          </p>
        </div>

        {/* Application Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
          {/* Students Card */}
          <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow duration-300">
            <div className="p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Students</h2>
              <div className="aspect-w-16 aspect-h-9 mb-6">
                <img 
                  src="/images/student.jpg"
                  alt="Students working on a project"
                  className="object-cover rounded-lg"
                />
              </div>
              <div className="space-y-4">
                <div className="bg-blue-100 p-4 rounded-lg">
                  <p className="font-semibold text-blue-900">
                    Applications are open until March 10th!
                  </p>
                </div>
                <p className="text-gray-600">
                  We accept students who will be entering 6th, 7th, 8th, or 9th grades in the
                  2024-2025 School Year.
                </p>
                <a
                  href="https://forms.gle/Xd2DrjGATbq175NC6"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors duration-200"
                >
                  Apply to dynaMIT!
                </a>
              </div>
            </div>
          </div>

          {/* Mentors Card */}
          <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow duration-300">
            <div className="p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Mentors</h2>
              <div className="aspect-w-16 aspect-h-9 mb-6">
                <img 
                  src="/images/mentor.jpg"
                  alt="MIT student mentoring"
                  className="object-cover rounded-lg"
                />
              </div>
              <div className="space-y-4">
                <div className="bg-blue-100 p-4 rounded-lg">
                  <p className="font-semibold text-blue-900">
                    Applications for dynaMIT mentors are open!
                  </p>
                </div>
                <p className="text-gray-600">
                  Join us as a mentor and help inspire the next generation of STEM enthusiasts.
                  All MIT undergraduate students are welcome to apply!
                </p>
                <a
                  href="https://forms.gle/9xV1USV2REbJL5716"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors duration-200"
                >
                  Teach at dynaMIT!
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Information */}
        <div className="mt-16 bg-white rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Important Dates</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Week 1: Rising 6th/7th Graders</h3>
              <p className="text-gray-600">August 11th to August 15th, 2025</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Week 2: Rising 8th/9th Graders</h3>
              <p className="text-gray-600">August 18th to August 22nd, 2025</p>
            </div>
          </div>
          <div className="mt-6">
            <p className="text-gray-600">
              All sessions are held in-person on the MIT campus. For any questions about the application process,
              please check our <a href="/faq" className="text-blue-600 hover:underline">FAQ page</a> or contact us directly.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Apply;
