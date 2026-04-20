import { Link } from "react-router-dom";
import { studentDeadline, calculateRemainingDays, openApps } from "../../utils";

const ApplicationBanner = () => {
  const studentDaysRemaining = calculateRemainingDays(studentDeadline);

  if (studentDaysRemaining <= 0 || openApps == 0) return null;

  return (
    <div className="bg-secondary py-2 text-center">
      <p className="text-sm text-white">
        Student applications close in{" "}
        <span className="font-semibold">{studentDaysRemaining}</span> day
        {studentDaysRemaining === 1 ? "" : "s"}.{" "}
        <Link
          to="/apply"
          className="font-semibold text-white underline-offset-2 hover:underline"
        >
          Apply now
        </Link>
      </p>
    </div>
  );
};

export default ApplicationBanner;
