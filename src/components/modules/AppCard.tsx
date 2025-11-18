import React from "react";
import {
  formatDateToReadableString,
  calculateRemainingDays,
  openApps,
} from "../../utils";

interface AppCardProps {
  title: string;
  deadline: Date;
  link: string;
  description: string;
  linkText: string;
  interestLink?: string;
  interestLinkText?: string;
}

const AppCard: React.FC<AppCardProps> = ({
  title,
  deadline,
  link,
  description,
  linkText,
  interestLink,
  interestLinkText,
}) => {
  const localDeadline = new Date(
    deadline.toLocaleString("default", { timeZone: "UTC" })
  ); // Convert to local time
  const daysRemaining = calculateRemainingDays(localDeadline);

  let banner = null;

  if (daysRemaining > 0 && openApps == 1) {
    banner = (
      <div className="rounded-lg bg-light p-4">
        <p className="font-semibold text-dark">
          Applications open until {formatDateToReadableString(localDeadline)}!
        </p>
      </div>
    );
  } else if (daysRemaining < 0) {
    banner = (
      <div className="rounded-lg bg-secondary-light p-4">
        <p className="font-semibold text-dark">Applications are now closed.</p>
      </div>
    );
  } else {
    banner = (
      <div className="rounded-lg bg-green-200 p-4">
        <p className="font-semibold text-dark">Applications open soon!</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-white p-6 shadow-lg">
      <div className="p-8">
        <h2 className="mb-4 text-2xl font-bold text-dark">{title}</h2>
        <div className="space-y-4">
          {banner}
          <p className="text-dark">{description}</p>
          {daysRemaining > 0 && openApps == 1 ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-lg bg-primary px-6 py-3 text-white transition-colors duration-200"
            >
              {linkText}
            </a>
          ) : (
            interestLink &&
            interestLinkText && (
              <a
                href={interestLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-lg bg-primary px-6 py-3 text-white transition-colors duration-200"
              >
                {interestLinkText}
              </a>
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default AppCard;
