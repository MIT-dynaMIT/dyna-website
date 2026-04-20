import { useEffect, useState } from 'react';
import {
  mentorDeadline,
  calculateRemainingDays,
  openApps,
} from '../../utils';

type ToastConfig = {
  id: string;
  title: string;
  message: string;
  ctaLabel: string;
  ctaHref: string;
  ctaExternal?: boolean;
};

const dismissKey = (id: string) => `dynamit-toast-dismissed:${id}`;

const HomeToasts = () => {
  const [visible, setVisible] = useState<string[]>([]);

  const toasts: ToastConfig[] = [];

  const mentorDaysRemaining = calculateRemainingDays(mentorDeadline);
  const mentorAppsOpen = mentorDaysRemaining > 0 && openApps === 1;
  if (!mentorAppsOpen) {
    toasts.push({
      id: 'mentors-rolling-s26',
      title: 'Still looking for mentors',
      message: "Email the board if you'd like to chat more.",
      ctaLabel: 'Email us',
      ctaHref: 'mailto:dynamit_board@mit.edu',
    });
  }

  toasts.push({
    id: 'donate-s26',
    title: 'Help us power summer 2026',
    message: 'Every contribution keeps dynaMIT free for students.',
    ctaLabel: 'Donate',
    ctaHref: 'https://crowdfund.mit.edu/story/dynaMIT-S26',
    ctaExternal: true,
  });

  useEffect(() => {
    const active = toasts
      .filter((t) => {
        try {
          return localStorage.getItem(dismissKey(t.id)) !== '1';
        } catch {
          return true;
        }
      })
      .map((t) => t.id);

    const timer = setTimeout(() => setVisible(active), 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = (id: string) => {
    try {
      localStorage.setItem(dismissKey(id), '1');
    } catch {
      // storage unavailable — still hide for this session
    }
    setVisible((prev) => prev.filter((v) => v !== id));
  };

  const shown = toasts.filter((t) => visible.includes(t.id));
  if (shown.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3"
    >
      {shown.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto animate-fade-in-up overflow-hidden rounded-xl bg-white ring-1 ring-dark/10 shadow-card-hover"
        >
          <div className="flex items-start gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 text-sm font-semibold text-dark">
                {t.title}
              </p>
              <p className="text-sm leading-snug text-dark/70">{t.message}</p>
              <a
                href={t.ctaHref}
                {...(t.ctaExternal
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
                className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary transition-colors duration-150 hover:text-primary-dark"
              >
                {t.ctaLabel}
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </a>
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-dark/40 transition-colors duration-150 hover:bg-dark/5 hover:text-dark/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default HomeToasts;
