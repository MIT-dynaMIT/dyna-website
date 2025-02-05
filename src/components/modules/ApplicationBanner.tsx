import { Link } from 'react-router-dom';
import { studentDeadline, calculateRemainingDays } from '../../utils';

const ApplicationBanner = () => {
  const studentDaysRemaining = calculateRemainingDays(studentDeadline);

  if (studentDaysRemaining <= 0) return null;

  return (
    <div className="bg-accent p-0 text-center">
      <p className="text-sm font-bold text-dark">
        Student Applications close in <span className="text-secondary">{studentDaysRemaining}</span> day{studentDaysRemaining === 1 ? '' : 's'}! 
        <Link to="/apply" className="text-primary transition-colors duration-200 hover:text-dark">
          {` Apply Now`}
        </Link>
      </p>
    </div>
  );
};

export default ApplicationBanner;
