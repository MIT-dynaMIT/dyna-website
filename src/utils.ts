const studentDeadline = new Date("2026-03-10");
const mentorDeadline = new Date("2026-03-02");

const week1Start = new Date("2026-08-10");
const week1End = new Date("2026-08-14");
const week2Start = new Date("2026-08-17");
const week2End = new Date("2026-08-21");

export const openApps: number = 0; // whether apps are open or not

const studentAppLink = "https://forms.gle/ZV34bjNpGNvboC8t7";
const studentInterestLink = "https://forms.gle/DCDAQWJayEc6MNTQA";
const mentorAppLink = "https://forms.gle/rmdtGE5DMwzWLxs27";

const calculateRemainingDays = (deadline: Date): number => {
  const today = new Date();
  const timeDiff = deadline.getTime() - today.getTime();
  return Math.ceil(timeDiff / (1000 * 3600 * 24));
};

const formatDateToReadableString = (date: Date): string => {
  const localDate = new Date(
    date.toLocaleString("default", { timeZone: "UTC" })
  ); // Convert to local time
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const month = monthNames[localDate.getMonth()]; // Get the month name
  const day = localDate.getDate(); // Get the day of the month

  // Function to get the day suffix (e.g., 'st', 'nd', 'rd', 'th')
  const getDaySuffix = (day: number): string => {
    if (day >= 11 && day <= 13) return "th"; // Special case for 11th, 12th, 13th
    switch (day % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  };

  const daySuffix = getDaySuffix(day);

  return `${month} ${day}${daySuffix}`;
};

const formatDateToStringWithYear = (date: Date): string => {
  const year = date.getFullYear();
  return `${formatDateToReadableString(date)}, ${year}`;
};

interface FAQItemObj {
  question: string;
  answer: string;
}

const faqs: FAQItemObj[] = [
  {
    question: `When is the dynaMIT Summer ${week1Start.getFullYear()} program?`,
    answer: `Week 1 will run from ${formatDateToReadableString(
      new Date(week1Start.toLocaleString())
    )} to ${formatDateToReadableString(
      new Date(week1End.toLocaleString())
    )}, hosting rising 6th/7th graders. Week 2 will run from ${formatDateToReadableString(
      new Date(week2Start.toLocaleString())
    )} to ${formatDateToReadableString(
      new Date(week2End.toLocaleString())
    )}, hosting rising 8th/9th graders. Our program is fully in-person on MIT campus!`,
  },
  {
    question: "Where is dynaMIT located?",
    answer:
      "dynaMIT is located on MIT campus and the entire duration of the program happens in MIT.",
  },
  {
    question: "Will dynaMIT provide housing or transportation?",
    answer:
      "No, dynaMIT is not a sleepaway camp so we rely on parents to provide housing and transportation to and from camp. Ideally students will be coming from the Boston area (or somewhere close), so housing should not be an issue.",
  },
  {
    question: "Is dynaMIT free?",
    answer:
      "Yes, dynaMIT is completely free of charge to the students, though individuals are more than welcome to donate to our cause in order to help us keep the camp free. However, donations are not required by any means.",
  },
  {
    question: "Who are the instructors at dynaMIT? How can I volunteer?",
    answer:
      "All of our mentors are current MIT undergraduate students who volunteer a week of their time in the summer to teach at camp. MIT students interested in applying to be a mentor should apply now!",
  },
  {
    question: "How are students selected for the program?",
    answer:
      "We do our best to accept students based on need as we hope to make STEM education more accessible for the underserved.",
  },
];

export {
  studentDeadline,
  mentorDeadline,
  week1Start,
  week1End,
  week2Start,
  week2End,
  faqs,
  calculateRemainingDays,
  formatDateToReadableString,
  formatDateToStringWithYear,
  studentAppLink,
  mentorAppLink,
  studentInterestLink,
};
