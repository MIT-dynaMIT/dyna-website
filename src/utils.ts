const studentDeadline = new Date('2025-04-01'); // Example date for student applications
const mentorDeadline = new Date('2025-03-15'); // Example date for mentor applications

const week1Start = new Date('2025-08-11');
const week1End = new Date('2025-08-15');
const week2Start = new Date('2025-08-18');
const week2End = new Date('2025-08-22');

const calculateRemainingDays = (deadline: Date): number => {
  const today = new Date();
  const timeDiff = deadline.getTime() - today.getTime();
  return Math.ceil(timeDiff / (1000 * 3600 * 24));
};

const formatDateToReadableString = (date: Date): string => {
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const month = monthNames[date.getMonth()]; // Get the month name
  const day = date.getDate(); // Get the day of the month

  // Function to get the day suffix (e.g., 'st', 'nd', 'rd', 'th')
  const getDaySuffix = (day: number): string => {
    if (day >= 11 && day <= 13) return "th"; // Special case for 11th, 12th, 13th
    switch (day % 10) {
      case 1: return "st";
      case 2: return "nd";
      case 3: return "rd";
      default: return "th";
    }
  };

  const daySuffix = getDaySuffix(day);

  return `${month} ${day}${daySuffix}`;
}

const formatDateToStringWithYear = (date: Date): string => {
  const year = date.getFullYear();
  return `${formatDateToReadableString(date)}, ${year}`;
}

export { 
  studentDeadline, 
  mentorDeadline, 
  week1Start, 
  week1End, 
  week2Start, 
  week2End, 
  calculateRemainingDays, 
  formatDateToReadableString,
  formatDateToStringWithYear
};