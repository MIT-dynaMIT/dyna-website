import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const location = useLocation();

  const navigation = [
    { name: 'Home', href: '/' },
    { name: 'Apply', href: '/apply' },
    { name: 'Board', href: '/board' },
  ];

  const isCurrentPage = (path: string) => {
    return location.pathname === path;
  };

  return (
    <nav className="sticky top-0 z-40 border-b border-white/10 bg-primary/90 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-primary/75">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center">
            <Link
              to="/"
              className="flex items-center gap-2 text-lg font-bold text-white transition-opacity duration-200 hover:opacity-90"
            >
              <span className="font-display tracking-tight">
                dyna<span className="text-secondary-light">MIT</span>
              </span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden sm:ml-8 sm:flex sm:space-x-1">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`relative rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200
                    ${isCurrentPage(item.href)
                      ? 'text-white'
                      : 'text-white/80 hover:text-white'
                    }`}
                >
                  {item.name}
                  <span
                    className={`pointer-events-none absolute inset-x-3 bottom-1 h-0.5 origin-left rounded-full bg-secondary-light transition-transform duration-300
                      ${isCurrentPage(item.href) ? 'scale-x-100' : 'scale-x-0'}`}
                  />
                </Link>
              ))}
            </div>
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center sm:hidden">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="inline-flex items-center justify-center rounded-md p-2 text-white transition-colors duration-200 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary-light"
              aria-expanded={isMenuOpen}
            >
              <span className="sr-only">Open main menu</span>
              {!isMenuOpen ? (
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              ) : (
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out sm:hidden ${
          isMenuOpen ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-1 border-t border-white/10 bg-primary/95 px-2 pb-3 pt-2 backdrop-blur">
          {navigation.map((item) => (
            <Link
              key={item.name}
              to={item.href}
              className={`block rounded-md px-3 py-2 text-base font-medium transition-colors duration-200
                ${isCurrentPage(item.href)
                  ? 'bg-white/10 text-secondary-light'
                  : 'text-white hover:bg-white/10 hover:text-secondary-light'
                }`}
              onClick={() => setIsMenuOpen(false)}
            >
              {item.name}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
