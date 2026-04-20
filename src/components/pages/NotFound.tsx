import { Link } from "react-router-dom";

const NotFound = () => {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="mb-3 font-display text-3xl font-bold text-dark sm:text-4xl">
        404 — Page not found
      </h1>
      <p className="mb-8 max-w-md text-dark/70">
        The page you are looking for doesn't exist or has been moved.
      </p>
      <Link
        to="/"
        className="inline-block rounded-lg bg-primary px-5 py-3 font-semibold text-white transition-colors duration-200 hover:bg-primary-dark"
      >
        Go back home
      </Link>
    </div>
  );
};

export default NotFound;
