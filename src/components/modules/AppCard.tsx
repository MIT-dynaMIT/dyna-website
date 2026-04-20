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
  rollingEmail?: string;
  rollingMessage?: string;
}

const AppCard: React.FC<AppCardProps> = ({
  title,
  deadline,
  link,
  description,
  linkText,
  interestLink,
  interestLinkText,
  rollingEmail,
  rollingMessage,
}) => {
  const localDeadline = new Date(
    deadline.toLocaleString("default", { timeZone: "UTC" })
  );
  const daysRemaining = calculateRemainingDays(localDeadline);

  const isOpen = daysRemaining > 0 && openApps == 1;
  const isClosed = daysRemaining < 0 || openApps == 0;
  const isRolling = isClosed && !!rollingEmail;

  let banner = null;

  if (isOpen) {
    banner = (
      <div className="rounded-md border-l-4 border-primary bg-light/40 px-4 py-3">
        <p className="text-sm font-medium text-dark">
          Applications open until {formatDateToReadableString(localDeadline)}
        </p>
      </div>
    );
  } else if (isRolling) {
    banner = (
      <div className="rounded-md border-l-4 border-primary bg-light/40 px-4 py-3">
        <p className="text-sm font-medium text-dark">
          {rollingMessage ?? "We're still looking — reach out to chat!"}
        </p>
      </div>
    );
  } else if (isClosed) {
    banner = (
      <div className="rounded-md border-l-4 border-secondary bg-secondary-light/50 px-4 py-3">
        <p className="text-sm font-medium text-dark">Applications are now closed.</p>
      </div>
    );
  } else {
    banner = (
      <div className="rounded-md border-l-4 border-green-500 bg-green-50 px-4 py-3">
        <p className="text-sm font-medium text-dark">Applications open soon.</p>
      </div>
    );
  }

  const applyBtn = (href: string, text: string, external = true) => (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="inline-flex items-center rounded-lg bg-primary px-5 py-3 font-semibold text-white transition-colors duration-200 hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      {text}
    </a>
  );

  let cta: React.ReactNode = null;
  if (isOpen) {
    cta = applyBtn(link, linkText);
  } else if (isRolling) {
    cta = applyBtn(`mailto:${rollingEmail}`, `Email ${rollingEmail}`, false);
  } else if (interestLink && interestLinkText) {
    cta = applyBtn(interestLink, interestLinkText);
  }

  return (
    <div className="flex h-full flex-col rounded-2xl bg-white p-7 ring-1 ring-dark/5 shadow-card sm:p-8">
      <h2 className="mb-5 font-display text-2xl font-bold text-dark">{title}</h2>
      <div className="flex flex-1 flex-col gap-5 text-left">
        {banner}
        <p className="text-dark/80 leading-relaxed">{description}</p>
        <div className="mt-auto">{cta}</div>
      </div>
    </div>
  );
};

export default AppCard;
